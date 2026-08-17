# Uncommitted Changes (Working Copy, View-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show uncommitted changes as a synthetic node pinned at the top of the commit railway, with Staged / Unstaged / Untracked grouped in the files panel and each file's diff viewable in the normal diff viewer. Read-only — no staging/commit in this iteration.

**Architecture:** Two new read commands (`working_status`, `working_file_diff`) driving system git. The railway injects a synthetic pseudo-commit (`hash = WORKING_HASH`, `parents = [head]`) into its existing commit list so the unchanged lane engine (`computeGraph`) places it on HEAD's lane; a dedicated `WorkingRow` renders it. Selecting it swaps a new `WorkingCopyDetail` into the files panel (in place of `CommitDetail`); it reuses the existing `DiffView` (so the ignore-whitespace toggle and scroll-reset apply). `CommitDetail` and `CompareDetail` (PR view) are untouched.

**Tech Stack:** Existing — Tauri 2, Rust (system git via `git::run`), React/TS 7, tauri-specta bindings, react-virtuoso. No new deps.

**Spec:** `docs/superpowers/specs/2026-07-29-uncommitted-changes-design.md`.

## Global Constraints

- **System git only**; all git through `git::run`. No libgit2.
- **Frontend uses only generated bindings**; regenerate HEADLESSLY (`cargo test --manifest-path src-tauri/Cargo.toml export_bindings`); never `npm run tauri dev`; never commit `src/ipc/bindings.ts`.
- Specta types are snake_case; a unit enum serializes as a string union — the frontend must pass EXACTLY the strings the regenerated bindings show for `WorkingSection` (confirm after regen; do not assume case).
- New commands register in `collect_commands!` on the single builder.
- TS7; Biome verbatim; theme-aware (CSS vars only); frequent commits; author if unset `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.
- Preserve the loop-safe detail pattern (genRef/reqRef stale-guards; `onFileDiff` held in a ref; main load effect deps exclude the callback).
- **View-only:** no write commands, no stage/unstage/discard/commit. Do not add working-tree filesystem watching (deferred).

## File Structure

- `src-tauri/src/git/run.rs` (modify) — add `run_allowing(app, repo, args, extra_ok)`; make `run` delegate to it.
- `src-tauri/src/git/working.rs` (new) — `WorkingStatus`, `WorkingSection`, `parse_working_status`, `working_status`, `working_file_diff` (git-module fns).
- `src-tauri/src/commands/repo_read.rs` (modify) — command wrappers `working_status`, `working_file_diff`.
- `src-tauri/src/lib.rs` (modify) — `mod` wiring (via `git`) + register the two commands.
- `src/railway/working.ts` (new) — `WORKING_HASH` constant + `makeWorkingNode(head, counts)` helper.
- `src/railway/useWorkingNode.ts` (new) — hook fetching `working_status` → `{ node, counts }`.
- `src/railway/WorkingRow.tsx` (new) — renders the synthetic row (icon + label + counts), same layout as `CommitRow`.
- `src/railway/CommitRailway.tsx` (modify) — inject the node into `rows`, render `WorkingRow` for the sentinel.
- `src/detail/WorkingCopyDetail.tsx` (new) — grouped Staged/Unstaged/Untracked sections + diff loading.
- `src/detail/WorkingCopyDetail.css` (new) — section styling.
- `src/workspace/Workspace.tsx` (modify) — render `WorkingCopyDetail` when the working node is selected.
- `src/railway/CommitRailway.css` / `src/railway/CommitRow.css` (modify, whichever holds row styles) — `.commit-row.is-working` styling.

---

### Task 1: Backend — `working_status`

**Files:**
- Create: `src-tauri/src/git/working.rs`
- Modify: `src-tauri/src/git/mod.rs` (add `pub mod working;`), `src-tauri/src/commands/repo_read.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `pub struct WorkingStatus { pub head: Option<String>, pub staged: Vec<FileChange>, pub unstaged: Vec<FileChange>, pub untracked: Vec<FileChange> }` (derive `Debug, Clone, Serialize, specta::Type`).
  - `pub fn parse_working_status(z: &str) -> (Vec<FileChange>, Vec<FileChange>, Vec<FileChange>)` returning `(staged, unstaged, untracked)` — pure, unit-tested.
  - `pub fn working_status(app, repo_path) -> Result<WorkingStatus, GitError>`.
  - Command `working_status(app, repo_path: String) -> Result<WorkingStatus, GitError>` (`workingStatus`).

- [ ] **Step 1: Write the parser test**

Create `src-tauri/src/git/working.rs` with the parser + a unit test. `FileChange` is defined in `crate::git::changes` — import it. The porcelain-v1 `-z` format: each record is `XY<space>PATH`, `\0`-terminated; a rename/copy record (`X` in `R`/`C`) is followed by an extra `\0`-terminated ORIG path. Parse by splitting on `\0` and consuming an extra token after a rename/copy record.
```rust
use crate::git::changes::FileChange;
use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct WorkingStatus {
	pub head: Option<String>,
	pub staged: Vec<FileChange>,
	pub unstaged: Vec<FileChange>,
	pub untracked: Vec<FileChange>,
}

/// Parse `git status --porcelain=v1 -z -uall` output into
/// (staged, unstaged, untracked). `X` = index-vs-HEAD, `Y` = worktree-vs-index.
pub fn parse_working_status(z: &str) -> (Vec<FileChange>, Vec<FileChange>, Vec<FileChange>) {
	let mut staged = Vec::new();
	let mut unstaged = Vec::new();
	let mut untracked = Vec::new();
	let mut it = z.split('\u{0}');
	while let Some(rec) = it.next() {
		if rec.is_empty() {
			continue;
		}
		// rec = "XY PATH"; bytes 0,1 are X,Y; byte 2 is a space; rest is path.
		let bytes = rec.as_bytes();
		if bytes.len() < 4 {
			continue;
		}
		let x = bytes[0] as char;
		let y = bytes[1] as char;
		let path = rec[3..].to_string();
		if x == '?' && y == '?' {
			untracked.push(FileChange { status: "?".to_string(), path });
			continue;
		}
		if x == '!' && y == '!' {
			continue; // ignored
		}
		// Rename/copy carries an extra ORIG path token we must consume + ignore.
		if x == 'R' || x == 'C' {
			let _orig = it.next();
		}
		if x != ' ' {
			staged.push(FileChange { status: x.to_string(), path: path.clone() });
		}
		if y != ' ' {
			unstaged.push(FileChange { status: y.to_string(), path });
		}
	}
	(staged, unstaged, untracked)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn splits_staged_unstaged_untracked() {
		// M  staged-only ; " M" unstaged-only ; "MM" both ; "A " added-staged ;
		// " D" deleted-unstaged ; "R " rename (with orig) ; "??" untracked
		let z = "M  a.txt\u{0} M b.txt\u{0}MM c.txt\u{0}A  d.txt\u{0} D e.txt\u{0}R  new.txt\u{0}old.txt\u{0}?? u.txt\u{0}";
		let (staged, unstaged, untracked) = parse_working_status(z);
		let sp: Vec<_> = staged.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
		let up: Vec<_> = unstaged.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
		let tp: Vec<_> = untracked.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
		assert_eq!(sp, vec![("M", "a.txt"), ("M", "c.txt"), ("A", "d.txt"), ("R", "new.txt")]);
		assert_eq!(up, vec![("M", "b.txt"), ("M", "c.txt"), ("D", "e.txt")]);
		assert_eq!(tp, vec![("?", "u.txt")]);
	}
}
```
NOTE: porcelain-v1 always emits exactly two status chars then a space, so `rec[3..]` is the path. Verify the rename branch consumes the orig token so it isn't parsed as its own record. (If a real `git` on the dev box emits a subtly different `-z` layout, adjust the slice indices — but v1 is stable.)

Add `pub mod working;` to `src-tauri/src/git/mod.rs` (match how `changes`/`compare` are declared there).

- [ ] **Step 2: Run the test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml working::tests::splits -- --nocapture`
Expected: PASS.

- [ ] **Step 3: Add `working_status` (git module fn)**

Append to `working.rs`:
```rust
pub fn working_status(app: &tauri::AppHandle, repo_path: &str) -> Result<WorkingStatus, GitError> {
	let z = run(
		app,
		repo_path,
		&["status", "--porcelain=v1", "-z", "--untracked-files=all"],
	)?;
	let (staged, unstaged, untracked) = parse_working_status(&z);
	let head = run(app, repo_path, &["rev-parse", "HEAD"])
		.ok()
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty());
	Ok(WorkingStatus { head, staged, unstaged, untracked })
}
```

- [ ] **Step 4: Command wrapper + register**

In `src-tauri/src/commands/repo_read.rs`, import and add:
```rust
#[tauri::command]
#[specta::specta]
pub fn working_status(
	app: tauri::AppHandle,
	repo_path: String,
) -> Result<crate::git::working::WorkingStatus, crate::git::run::GitError> {
	crate::git::working::working_status(&app, &repo_path)
}
```
In `src-tauri/src/lib.rs`, add `commands::repo_read::working_status` to `collect_commands![...]`.

- [ ] **Step 5: Build, test, regenerate bindings**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`
Expected: all pass; `src/ipc/bindings.ts` shows `workingStatus(repoPath): Promise<Result<WorkingStatus, GitError>>` and a `WorkingStatus` type with `head`, `staged`, `unstaged`, `untracked`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: working_status command (staged/unstaged/untracked)"
```

---

### Task 2: Backend — `working_file_diff` (+ exit-code-tolerant run helper)

**Files:**
- Modify: `src-tauri/src/git/run.rs`, `src-tauri/src/git/working.rs`, `src-tauri/src/commands/repo_read.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `run_raw` (private, same module) for the helper.
- Produces:
  - `pub fn run_allowing(app, repo_path, args, extra_ok: &[i32]) -> Result<String, GitError>` in `run.rs`; `run` delegates to `run_allowing(app, repo, args, &[])`.
  - `pub enum WorkingSection { Staged, Unstaged, Untracked }` (derive `Debug, Clone, Copy, Deserialize, specta::Type`).
  - `pub fn working_file_diff(app, repo_path, path, section, ignore_whitespace) -> Result<String, GitError>`.
  - Command `working_file_diff(app, repo_path, path, section, ignore_whitespace) -> Result<String, GitError>` (`workingFileDiff`).

- [ ] **Step 1: `run_allowing` in run.rs, `run` delegates**

In `src-tauri/src/git/run.rs`, refactor. Keep `run_raw` as-is. Replace the body of `run` and add `run_allowing`:
```rust
pub fn run(app: &tauri::AppHandle, repo_path: &str, args: &[&str]) -> Result<String, GitError> {
	run_allowing(app, repo_path, args, &[])
}

/// Like `run`, but treats exit codes in `extra_ok` (besides 0) as success.
/// Needed for `git diff --no-index`, which exits 1 when files differ.
pub fn run_allowing(
	app: &tauri::AppHandle,
	repo_path: &str,
	args: &[&str],
	extra_ok: &[i32],
) -> Result<String, GitError> {
	let (stdout, entry) = run_raw(repo_path, args)?;
	let exit_code = entry.exit_code;
	let stderr = entry.stderr.clone();
	{
		use tauri::Manager;
		if let Some(log) = app.try_state::<crate::console_log::ConsoleLog>() {
			log.push(entry.clone());
		}
	}
	let _ = entry.emit(app);
	if exit_code == 0 || extra_ok.contains(&exit_code) {
		Ok(stdout)
	} else {
		Err(GitError::NonZero { code: exit_code, stderr })
	}
}
```
(This preserves the M2c ring-buffer push + emit exactly; `run` behavior is unchanged for all existing callers.)

- [ ] **Step 2: Add the section enum + diff fn (with a git-level test)**

Append to `src-tauri/src/git/working.rs`:
```rust
use crate::git::run::run_allowing;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
pub enum WorkingSection {
	Staged,
	Unstaged,
	Untracked,
}

pub fn working_file_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	path: &str,
	section: WorkingSection,
	ignore_whitespace: bool,
) -> Result<String, GitError> {
	let mut args: Vec<&str> = vec!["diff", "--no-color"];
	match section {
		WorkingSection::Staged => args.push("--cached"),
		WorkingSection::Unstaged => {}
		WorkingSection::Untracked => args.push("--no-index"),
	}
	if ignore_whitespace {
		args.push("-w");
	}
	match section {
		WorkingSection::Untracked => {
			args.push("--");
			args.push("/dev/null");
			args.push(path);
			// --no-index exits 1 when the files differ (always, here).
			run_allowing(app, repo_path, &args, &[1])
		}
		_ => {
			args.push("--");
			args.push(path);
			run(app, repo_path, &args)
		}
	}
}
```
Add an integration test in `working.rs`'s test module that builds a temp repo (mirror the `git(dir, args)` + tempdir mechanism used by `compare.rs`'s tests — reuse it, don't add a dep) with: a committed file modified-and-staged, another file modified-unstaged, and an untracked file. Then assert at the GIT LEVEL (shell out, since these fns need an AppHandle — same approach as `compare.rs`): `git -C <dir> diff --cached -- staged.txt` is non-empty; `git -C <dir> diff -- unstaged.txt` is non-empty; `git -C <dir> diff --no-index -- /dev/null untracked.txt` (allowing exit 1) is non-empty and contains `+`-added lines; and `git -C <dir> diff -w -- <indent-only-change>` is empty. Name it `working_diff_sections_route_correctly`.

- [ ] **Step 3: Command wrapper + register**

In `src-tauri/src/commands/repo_read.rs`:
```rust
#[tauri::command]
#[specta::specta]
pub fn working_file_diff(
	app: tauri::AppHandle,
	repo_path: String,
	path: String,
	section: crate::git::working::WorkingSection,
	ignore_whitespace: bool,
) -> Result<String, crate::git::run::GitError> {
	crate::git::working::working_file_diff(&app, &repo_path, &path, section, ignore_whitespace)
}
```
Register `commands::repo_read::working_file_diff` in `collect_commands![...]`.

- [ ] **Step 4: Build, test, regenerate**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`
Expected: pass; bindings show `workingFileDiff(repoPath, path, section, ignoreWhitespace)` and a `WorkingSection` string-union type. **Record the exact union strings** (e.g. `"Staged" | "Unstaged" | "Untracked"`) — Task 4 must pass these verbatim.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: working_file_diff (staged/unstaged/untracked, -w aware)"
```

---

### Task 3: Frontend — inject the working node into the railway

**Files:**
- Create: `src/railway/working.ts`, `src/railway/useWorkingNode.ts`, `src/railway/WorkingRow.tsx`
- Modify: `src/railway/CommitRailway.tsx`, the row-styles CSS (`CommitRow.css` or `CommitRailway.css` — whichever defines `.commit-row`)

**Interfaces:**
- Consumes: `commands.workingStatus`, `type WorkingStatus`, `type CommitSummary`.
- Produces: `WORKING_HASH`, `makeWorkingNode(head, counts)`, `useWorkingNode(repoPath)` → `{ node: CommitSummary | null, counts: WorkingCounts | null }`, `<WorkingRow counts graphRow selected onClick />`.

- [ ] **Step 1: sentinel + node factory**

Create `src/railway/working.ts`:
```ts
import type { CommitSummary } from "../ipc/bindings"

export const WORKING_HASH = "__WORKING_COPY__"

export type WorkingCounts = { staged: number; unstaged: number; untracked: number }

export function makeWorkingNode(head: string, nowMs: number): CommitSummary {
	return {
		hash: WORKING_HASH,
		parents: [head],
		author_name: "",
		author_email: "",
		timestamp_ms: nowMs,
		refs: [],
		subject: "Uncommitted changes",
	}
}
```

- [ ] **Step 2: `useWorkingNode` hook**

Create `src/railway/useWorkingNode.ts`: on mount (and whenever `repoPath` changes) call `commands.workingStatus(repoPath)`. If it returns ok with `head !== null` and `staged+unstaged+untracked > 0`, set `node = makeWorkingNode(head, Date.now())` and `counts = {staged: staged.length, unstaged: unstaged.length, untracked: untracked.length}`; otherwise both null. Guard against setState-after-unmount (the `cancelled` pattern). Return `{ node, counts }`. (The railway remounts on `key={scope:refreshKey}`, so this re-fetches on manual Refresh and on M2c `repoChanged`.)

- [ ] **Step 3: `WorkingRow` component**

Create `src/railway/WorkingRow.tsx`. Mirror `CommitRow`'s outer button + `commit-graph-cell` + `CommitGraph` so the graph lane/connector aligns, but render a working-specific description instead of refs/author/hash/date:
```tsx
import { CommitGraph } from "./CommitGraph"
import type { GraphRow } from "./graphLayout"
import type { WorkingCounts } from "./working"

export function WorkingRow({
	counts,
	graphRow,
	selected,
	onClick,
}: {
	counts: WorkingCounts
	graphRow: GraphRow
	selected: boolean
	onClick: () => void
}) {
	const parts: string[] = []
	if (counts.staged > 0) parts.push(`${counts.staged} staged`)
	if (counts.unstaged > 0) parts.push(`${counts.unstaged} unstaged`)
	if (counts.untracked > 0) parts.push(`${counts.untracked} untracked`)
	return (
		<button
			type="button"
			className={`commit-row is-working ${selected ? "is-selected" : ""}`}
			onClick={onClick}
		>
			<div className="commit-graph-cell">
				<CommitGraph row={graphRow} />
			</div>
			<div className="commit-desc">
				<span className="commit-subject working-label">● Uncommitted changes</span>
			</div>
			<span className="working-counts">{parts.join(" · ")}</span>
		</button>
	)
}
```

- [ ] **Step 4: Inject into the railway**

In `src/railway/CommitRailway.tsx`:
- Call `useWorkingNode(repoPath)` → `{ node, counts }`.
- Build `const rows = useMemo(() => (node ? [node, ...commits] : commits), [node, commits])`.
- Replace uses of `commits` that drive the VIEW with `rows`: `computeGraph(rows.map(...))`, the Virtuoso `data={rows}`, keyboard nav (`selectIndex`/`move` over `rows`), `matches`/`matchedSet` over `rows`, and the `selectHash` find (over `rows`). Leave `loadMore`/`reachedEnd`/`useCommits` bound to the real `commits` (the synthetic node is never paged).
- In Virtuoso `itemContent`, branch on the sentinel:
  ```tsx
  const c = rows[index]
  if (c.hash === WORKING_HASH && counts) {
    return <WorkingRow counts={counts} graphRow={graph[index]} selected={c.hash === selectedHash} onClick={() => { onSelect(c); onCommitClick?.() }} />
  }
  return <CommitRow ... commit={c} graphRow={graph[index]} ... onClick={() => { onSelect(c); onCommitClick?.() }} />
  ```
  Match the existing `onClick`/`onCommitClick` wiring the current `CommitRow` uses (the row click already calls `onSelect` + `onCommitClick` — reuse that exact handler shape for both).
- Guard index math: the synthetic node occupies index 0 when present, so `Home` selects it; `End` still selects the last real commit. `selectHash` values are real hashes and never equal `WORKING_HASH`, so that effect is unaffected.

- [ ] **Step 5: Style `.commit-row.is-working`**

In the CSS file that defines `.commit-row`, add an `.is-working` treatment: a distinct accent color for `.working-label` (use `var(--accent)`), and `.working-counts` styled like a muted meta column (`var(--muted)`, right-aligned, matching the existing author/date column spacing). No hardcoded colors; keep row height = `ROW_HEIGHT`.

- [ ] **Step 6: Frontend tests + verify**

Add/extend a railway test: given `commands.workingStatus` mocked to return changes, the list renders a "Uncommitted changes" row at the top with the counts text; given no changes (or `head: null`), no such row. Mock `commands.workingStatus` in any test that mounts `CommitRailway`/`Workspace` (return `{ status: "ok", data: { head: null, staged: [], unstaged: [], untracked: [] } }` by default in `App.test.tsx`).
Run: `npx vitest run && npm run build && npm run lint`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: inject Uncommitted-changes node atop the commit railway"
```

---

### Task 4: Frontend — `WorkingCopyDetail` + Workspace wiring

**Files:**
- Create: `src/detail/WorkingCopyDetail.tsx`, `src/detail/WorkingCopyDetail.css`
- Modify: `src/workspace/Workspace.tsx`

**Interfaces:**
- Consumes: `commands.workingStatus`, `commands.workingFileDiff`, `WORKING_HASH`, the `WorkingSection` union strings from Task 2's bindings.

- [ ] **Step 1: `WorkingCopyDetail` component**

Create `src/detail/WorkingCopyDetail.tsx`. Props: `{ repoPath: string; onFileDiff: (diff: string, path: string | null) => void; ignoreWhitespace: boolean }`. Behavior:
- Fetch `commands.workingStatus(repoPath)` on mount (loop-safe: `genRef` bumped per load; `onFileDiff` held in `onFileDiffRef`; deps `[repoPath]` only — NOT the callback). Store `{ staged, unstaged, untracked }` and an `error`.
- Track `activeKey: { section, path } | null` (path alone can collide across sections for partially-staged files, so key by section+path).
- Render three sections in order Staged / Unstaged / Untracked, each with a header showing the name + count, only when non-empty. Each file is a button with a status badge + `MiddlePath` (reuse `MiddlePath` and the `detail-status` / `detail-file` classes/markup from `ChangedFilesList` for visual consistency; dim `.test.`/`.spec.` via `isTestFile` as that component does).
- `openFile(section, path)`: bump `reqRef`; setActiveKey; `const r = await commands.workingFileDiff(repoPath, path, section, ignoreWhitespace)`; stale-guard on genRef/reqRef; `onFileDiffRef.current(r.status === "ok" ? r.data : "", path)`. Use the EXACT `WorkingSection` strings from the regenerated bindings (Task 2 recorded them) — e.g. `"Staged"`.
- Re-fetch the open file when `ignoreWhitespace` flips (dedicated effect, dep `[ignoreWhitespace]`, guarded by `activeKey !== null`, calling `openFile(activeKey.section, activeKey.path)`).
- Keyboard nav (ArrowUp/Down) across the flattened visible files (staged → unstaged → untracked order), calling `openFile` for the next/prev; `role="listbox"` + `tabIndex={0}` like `ChangedFilesList`.
- Empty state: if all three are empty, show `<div className="detail-empty">No uncommitted changes.</div>`; on error show the stderr.

- [ ] **Step 2: `WorkingCopyDetail.css`**

Add section-header styling (`.wc-section-header` — muted, small caps or bold, with a count) and reuse existing `.detail-*` classes for the file rows. Theme tokens only.

- [ ] **Step 3: Workspace wiring**

In `src/workspace/Workspace.tsx`, import `WorkingCopyDetail` and `WORKING_HASH` (from `../railway/working`). In the bottom-left panel, extend the conditional. Current shape:
```tsx
{compareMode && compareHead !== null && compareBase ? (
	<CompareDetail ... />
) : (
	<CommitDetail ... />
)}
```
Change the `else` branch to route the working node:
```tsx
) : selected?.hash === WORKING_HASH ? (
	<WorkingCopyDetail
		repoPath={repo.path}
		onFileDiff={handleFileDiff}
		ignoreWhitespace={ignoreWhitespace}
	/>
) : (
	<CommitDetail
		repoPath={repo.path}
		selectedCommit={selected}
		onFileDiff={handleFileDiff}
		ignoreWhitespace={ignoreWhitespace}
	/>
)}
```
(Selecting the working node already exits compare via the railway's `onCommitClick`, so `compareMode` is false by the time this renders. `CommitDetail` treats `selectedCommit` with the sentinel hash as just an unknown commit if ever reached, but the guard above prevents that.)

- [ ] **Step 4: Tests + verify**

Add a `WorkingCopyDetail` test: mock `commands.workingStatus` to return one staged + one unstaged + one untracked file; assert three section headers with counts render; clicking the staged file calls `commands.workingFileDiff` with `section === "Staged"` (the exact binding string) and the path, and forwards the diff via `onFileDiff`. `App.test.tsx` already mocks `workingStatus`; add a `workingFileDiff: vi.fn().mockResolvedValue({ status: "ok", data: "" })` mock.
Run: `npx vitest run && npm run build && cargo build --manifest-path src-tauri/Cargo.toml && npm run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: WorkingCopyDetail — grouped staged/unstaged/untracked view"
```

---

## Self-Review

**Spec coverage:**
- View uncommitted changes → Tasks 1–4 ✓
- Staged/unstaged/untracked clearly visualized → Task 1 (classification) + Task 4 (grouped sections) ✓
- File diff works normally → Task 2 (`working_file_diff`) + Task 4 routes to the existing `DiffView`; ignore-whitespace honored ✓
- PR viewer keeps working → `CompareDetail` untouched; Workspace conditional adds the working branch without altering the compare branch ✓
- Top node in the railway → Task 3 (inject synthetic node + `WorkingRow`) ✓
- Refresh on `.git` changes → railway remounts on `refreshKey` (M2c `repoChanged` + manual) re-runs `useWorkingNode`; `WorkingCopyDetail` re-fetches on remount ✓ (working-tree-only edits need manual refresh — documented, deferred)

**Placeholder scan:** none.

**Type consistency:** `WorkingStatus`/`WorkingSection` defined in Task 1/2, consumed in Tasks 3/4 via regenerated bindings; `WORKING_HASH`/`makeWorkingNode`/`useWorkingNode`/`WorkingRow` defined in Task 3, consumed in Task 3/4; `working_file_diff` param order `(repoPath, path, section, ignoreWhitespace)` consistent across command, bindings, and call sites. The `WorkingSection` union strings are recorded in Task 2 and used verbatim in Task 4.

**Known risks:**
1. **Porcelain `-z` rename parsing** — the extra ORIG token must be consumed or it's mis-parsed as a record. Task 1's test covers the rename case; if the local git emits a different layout the slice/branch is adjusted there.
2. **`git diff --no-index` exit 1** — handled by `run_allowing(&[1])`; `run`'s behavior for all other callers is byte-identical (delegates with `&[]`).
3. **`/dev/null` on Windows** — git-for-windows accepts `/dev/null` in `--no-index`; acceptable for now (cross-platform verification is a follow-up if a Windows issue surfaces).
4. **Synthetic node in `--all` scope** — connects to HEAD, which may not be the top row, so the connector edge can be long; acceptable, cosmetic.
5. **Index shift from prepending the node** — all view logic switches to `rows`; `loadMore`/`reachedEnd` stay on the real `commits`. `selectHash` never equals `WORKING_HASH`. Verified in Task 3's wiring.
6. **Double `working_status` fetch** (railway hook + `WorkingCopyDetail`) — both cheap `git status`; acceptable, avoids lifting state for v1.
