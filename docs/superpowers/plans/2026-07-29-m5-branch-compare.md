# Milestone 5 — Branch Compare / PR Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user review a branch like a merge request — select a branch, toggle "Compare with base", and see only the net changes the branch introduces vs a base (changed files + per-file diff), **excluding** changes merged in from the base (main→feature merges), with the base auto-detected and overridable.

**Architecture:** Uses git's three-dot diff `git diff <base>...<head>` (= `merge-base(base,head)..head`), which is exactly PR-diff semantics — merged-in base changes drop out because the merge-base advances. New Rust commands (`default_branch`, `branch_diff`, `branch_file_diff`) mirror the existing `commit_files`/`file_diff` shapes. The frontend tracks an "active branch" (set when a branch ref is clicked in the sidebar); a header **Compare with base** toggle + base `<select>` switch the bottom files/diff panels from the selected-commit source to a new `CompareDetail` (branch-delta) source, reusing the existing file-row + DiffView UI. Builds on merged M1–M3c.

**Tech Stack:** Existing (Tauri 2, Rust, React 18, TS7, tauri-specta, Vitest, Biome). No new deps.

## Global Constraints

- **System git only** via `git::run::run` (logged to console); never libgit2. Always `git -C <repo> …`.
- **Frontend uses only generated bindings** (`src/ipc/bindings.ts`, git-ignored, generated). Regenerate HEADLESSLY: `cargo test --manifest-path src-tauri/Cargo.toml export_bindings`; never `npm run tauri dev`; never hand-edit/commit bindings.
- **New commands register in the existing `collect_commands![...]`** in `specta_builder()`; no second Builder; `.events(...)` intact.
- **Generated TS types snake_case**; `Result`-wrapped commands `{ status:"ok",data } | { status:"error",error }`; `GitError` externally-tagged.
- **Reuse existing pieces**: `FileChange`, `parse_name_status`, `dedupe_by_path` (in `git/changes.rs`); the `.detail-*` CSS + `MiddlePath` for the file list; `DiffView` for the diff; the async **stale-response guards** pattern (genRef for source change + reqRef for file click) from `CommitDetail`.
- **TS7; Biome 2.5.4 verbatim**; `npm run format` then `npm run lint` (one info notice expected).
- **Theme-aware**; **frequent commits**; commit author if unset `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.

## File Structure

- `src-tauri/src/git/compare.rs` (new) — `default_branch`, `branch_diff`, `branch_file_diff`.
- `src-tauri/src/git/mod.rs` (modify) — `pub mod compare;`.
- `src-tauri/src/commands/repo_read.rs` (modify) — command wrappers.
- `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs` (modify) — register.
- `src/detail/CompareDetail.tsx` (new) — branch-delta file list → diff.
- `src/sidebar/Sidebar.tsx` + `Sidebar.test.tsx` (modify) — `onSelectRef` passes `{ name, tip, kind }`.
- `src/workspace/Workspace.tsx` + `.css` (modify) — active-branch tracking, compare toggle + base select, swap CompareDetail in.

---

### Task 1: Backend — default base + branch three-dot diff

**Files:**
- Create: `src-tauri/src/git/compare.rs`; Modify: `src-tauri/src/git/mod.rs`

**Interfaces:**
- Consumes: `git::run::{run, GitError}`, `git::changes::{FileChange, parse_name_status, dedupe_by_path}`.
- Produces:
  - `pub fn default_branch(app, repo_path) -> Option<String>` — best-effort: `origin/HEAD` target, else first existing of `main`/`master`/`develop`, else `None`.
  - `pub fn branch_diff(app, repo_path, base: &str, head: &str) -> Result<Vec<FileChange>, GitError>` — `git diff --no-color --name-status -r -z <base>...<head>`, parsed + deduped.
  - `pub fn branch_file_diff(app, repo_path, base, head, path) -> Result<String, GitError>` — `git diff <base>...<head> -- <path>`.

- [ ] **Step 1: Write compare.rs with tests**

Create `src-tauri/src/git/compare.rs`:
```rust
use crate::git::changes::{dedupe_by_path, parse_name_status, FileChange};
use crate::git::run::{run, GitError};

/// Best-effort default base branch: origin/HEAD's target, else main/master/develop.
pub fn default_branch(app: &tauri::AppHandle, repo_path: &str) -> Option<String> {
	if let Ok(out) = run(
		app,
		repo_path,
		&["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
	) {
		let name = out.trim();
		if !name.is_empty() {
			return Some(name.to_string());
		}
	}
	for candidate in ["main", "master", "develop"] {
		if run(app, repo_path, &["rev-parse", "--verify", "--quiet", candidate]).is_ok() {
			return Some(candidate.to_string());
		}
	}
	None
}

/// Three-dot diff: net changes on `head` since it diverged from `base`
/// (excludes changes merged in from `base`).
pub fn branch_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	base: &str,
	head: &str,
) -> Result<Vec<FileChange>, GitError> {
	let range = format!("{}...{}", base, head);
	let z = run(
		app,
		repo_path,
		&["diff", "--no-color", "--name-status", "-r", "-z", &range],
	)?;
	Ok(dedupe_by_path(parse_name_status(&z)))
}

pub fn branch_file_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	base: &str,
	head: &str,
	path: &str,
) -> Result<String, GitError> {
	let range = format!("{}...{}", base, head);
	run(app, repo_path, &["diff", "--no-color", &range, "--", path])
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;

	fn git(dir: &std::path::Path, args: &[&str]) {
		Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
	}

	// Builds: base has A; feature branches off, adds B and edits A; base then also
	// edits a third file C; base is merged into feature. Three-dot base...feature
	// must show only feature's own changes (B added, A edited) — NOT C.
	fn repo() -> tempfile::TempDir {
		let d = tempfile::tempdir().unwrap();
		let p = d.path();
		git(p, &["init", "-b", "main"]);
		git(p, &["config", "user.email", "t@e.st"]);
		git(p, &["config", "user.name", "T"]);
		std::fs::write(p.join("a.txt"), "a1\n").unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-m", "base"]);
		git(p, &["checkout", "-b", "feature"]);
		std::fs::write(p.join("b.txt"), "b1\n").unwrap();
		std::fs::write(p.join("a.txt"), "a2\n").unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-m", "feature work"]);
		git(p, &["checkout", "main"]);
		std::fs::write(p.join("c.txt"), "c1\n").unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-m", "main-only change"]);
		git(p, &["checkout", "feature"]);
		git(p, &["merge", "main", "--no-edit"]);
		d
	}

	#[test]
	fn three_dot_excludes_merged_in_base_changes() {
		let d = repo();
		let path = d.path().to_str().unwrap();
		// Parse the raw diff ourselves via the same helpers the command uses.
		let range = "main...feature";
		let z = std::process::Command::new("git")
			.arg("-C")
			.arg(path)
			.args(["diff", "--name-status", "-r", "-z", range])
			.output()
			.unwrap();
		let out = dedupe_by_path(parse_name_status(&String::from_utf8_lossy(&z.stdout)));
		let paths: Vec<&str> = out.iter().map(|f| f.path.as_str()).collect();
		assert!(paths.contains(&"b.txt"), "feature's added file present");
		assert!(paths.contains(&"a.txt"), "feature's edit present");
		assert!(!paths.contains(&"c.txt"), "main-only change must be excluded");
	}
}
```
Add `pub mod compare;` to `src-tauri/src/git/mod.rs`.

- [ ] **Step 2: Run the test**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::compare`
Expected: PASS (proves three-dot excludes the merged-in `c.txt`). If `parse_name_status`/`dedupe_by_path` aren't `pub`, make them `pub` in `changes.rs`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: branch three-dot diff + default-branch detection"
```

---

### Task 2: Expose compare IPC commands

**Files:**
- Modify: `src-tauri/src/commands/repo_read.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces commands (generated names in parens):
  - `default_branch(repo_path) -> Option<String>` (`defaultBranch`)
  - `branch_diff(repo_path, base, head) -> Result<Vec<FileChange>, GitError>` (`branchDiff`)
  - `branch_file_diff(repo_path, base, head, path) -> Result<String, GitError>` (`branchFileDiff`)

- [ ] **Step 1: Add wrappers**

In `src-tauri/src/commands/repo_read.rs`:
```rust
use crate::git::compare::{
	branch_diff as bd, branch_file_diff as bfd, default_branch as db,
};

#[tauri::command]
#[specta::specta]
pub fn default_branch(app: tauri::AppHandle, repo_path: String) -> Option<String> {
	db(&app, &repo_path)
}

#[tauri::command]
#[specta::specta]
pub fn branch_diff(
	app: tauri::AppHandle,
	repo_path: String,
	base: String,
	head: String,
) -> Result<Vec<FileChange>, GitError> {
	bd(&app, &repo_path, &base, &head)
}

#[tauri::command]
#[specta::specta]
pub fn branch_file_diff(
	app: tauri::AppHandle,
	repo_path: String,
	base: String,
	head: String,
	path: String,
) -> Result<String, GitError> {
	bfd(&app, &repo_path, &base, &head, &path)
}
```
(`FileChange`/`GitError` are already imported in this file for the existing commands; add if missing.)

- [ ] **Step 2: Register + regenerate**

Append to `collect_commands![...]` in `lib.rs`: `commands::repo_read::default_branch, commands::repo_read::branch_diff, commands::repo_read::branch_file_diff`. Then `cargo build … && cargo test … export_bindings && npm run build`.
Expected: `commands.defaultBranch`/`branchDiff`/`branchFileDiff` present; `defaultBranch` returns `string | null`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: compare IPC commands (default branch, branch diff)"
```

---

### Task 3: `CompareDetail` component

Mirror `CommitDetail` but sourced from a base↔head branch diff.

**Files:**
- Create: `src/detail/CompareDetail.tsx`

**Interfaces:**
- Consumes: `commands.branchDiff`/`commands.branchFileDiff`, `FileChange`, the `.detail-*` CSS (already loaded by `CommitDetail.css`; import it or reuse), `MiddlePath`.
- Produces: `<CompareDetail repoPath base head onFileDiff />` — loads `branchDiff(repoPath, base, head)` into a file list; clicking a file loads `branchFileDiff(...)` and calls `onFileDiff(diff, path)`. Same stale-guards as `CommitDetail` (a `genRef` bumped when repoPath/base/head change; a `reqRef` for file clicks). Empty state: "No changes between {head} and {base}." On load error, show the `GitError` message.

- [ ] **Step 1: Implement**

Create `src/detail/CompareDetail.tsx`:
```tsx
import { useEffect, useRef, useState } from "react"
import { commands, type FileChange } from "../ipc/bindings"
import { MiddlePath } from "../ui/MiddlePath"
import "./CommitDetail.css"

export function CompareDetail({
	repoPath,
	base,
	head,
	onFileDiff,
}: {
	repoPath: string
	base: string
	head: string
	onFileDiff: (diff: string, path: string | null) => void
}) {
	const [files, setFiles] = useState<FileChange[]>([])
	const [activePath, setActivePath] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const genRef = useRef(0)
	const reqRef = useRef(0)
	const onFileDiffRef = useRef(onFileDiff)
	useEffect(() => {
		onFileDiffRef.current = onFileDiff
	}, [onFileDiff])

	useEffect(() => {
		genRef.current += 1
		const gen = genRef.current
		setActivePath(null)
		setFiles([])
		setError(null)
		onFileDiffRef.current("", null)
		commands.branchDiff(repoPath, base, head).then((r) => {
			if (genRef.current !== gen) {
				return
			}
			if (r.status === "ok") {
				setFiles(r.data)
			} else {
				setError("NonZero" in r.error ? r.error.NonZero.stderr : "Failed to diff branch")
			}
		})
	}, [repoPath, base, head])

	async function openFile(path: string) {
		const gen = genRef.current
		reqRef.current += 1
		const req = reqRef.current
		setActivePath(path)
		const r = await commands.branchFileDiff(repoPath, base, head, path)
		if (genRef.current !== gen || reqRef.current !== req) {
			return
		}
		onFileDiffRef.current(r.status === "ok" ? r.data : "", path)
	}

	if (error !== null) {
		return <div className="detail-empty">{error}</div>
	}
	if (files.length === 0) {
		return (
			<div className="detail-empty">
				No changes between {head} and {base}.
			</div>
		)
	}
	return (
		<div className="detail">
			<div className="detail-subject" title={`${base}...${head}`}>
				{head} ← {base}
			</div>
			<ul className="detail-files">
				{files.map((f) => (
					<li key={f.path}>
						<button
							type="button"
							className={`detail-file ${activePath === f.path ? "is-active" : ""}`}
							onClick={() => openFile(f.path)}
						>
							<span className={`detail-status s-${f.status[0]}`} title={f.status}>
								{f.status}
							</span>
							<MiddlePath path={f.path} className="detail-path" />
						</button>
					</li>
				))}
			</ul>
		</div>
	)
}
```
(This mirrors the loop-safe `CommitDetail` — `onFileDiff` held in a ref so the load effect doesn't depend on its identity; genRef/reqRef guards.)

- [ ] **Step 2: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: PASS (no test yet; wiring/test in Task 4).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: CompareDetail (branch-delta file list + diff)"
```

---

### Task 4: Sidebar active-branch + Workspace compare toggle

Track the active branch from sidebar clicks; add the "Compare with base" toggle + base `<select>`; swap `CompareDetail` into the files panel when comparing.

**Files:**
- Modify: `src/sidebar/Sidebar.tsx`, `src/sidebar/Sidebar.test.tsx`, `src/workspace/Workspace.tsx`, `src/workspace/Workspace.css`

**Interfaces:**
- Changed: `Sidebar` prop `onSelectRef: (ref: { name: string; tip: string; kind: "local" | "remote" | "tag" }) => void` (was `(tipHash: string) => void`). Local/remote/tag rows call it with the ref's name, tip, and kind.
- Workspace: `activeBranch: string | null` (a branch ref name; null for tags/none), `compareMode: boolean`, `compareBase: string | null`.

- [ ] **Step 1: Sidebar passes name + tip + kind**

In `src/sidebar/Sidebar.tsx`, change `onSelectRef` to receive `{ name, tip, kind }`:
- local branch row → `onSelectRef({ name: b.name, tip: b.tip, kind: "local" })`
- remote branch row → `onSelectRef({ name: rb.name, tip: rb.tip, kind: "remote" })`
- tag row → `onSelectRef({ name: t.name, tip: t.tip, kind: "tag" })`
Keep `activeHash` highlight behavior (still keyed on tip). Update `src/sidebar/Sidebar.test.tsx`: the click test now asserts `onSelectRef` was called with an object `{ name, tip, kind }` (e.g. `expect.objectContaining({ tip: "hFeature", kind: "local" })`).

- [ ] **Step 2: Workspace — track active branch + compare state**

In `src/workspace/Workspace.tsx`:
- State: `const [activeBranch, setActiveBranch] = useState<string | null>(null)`, `const [compareMode, setCompareMode] = useState(false)`, `const [compareBase, setCompareBase] = useState<string | null>(null)`.
- Sidebar handler:
```tsx
onSelectRef={(ref) => {
	setSelectHash(ref.tip)
	setActiveBranch(ref.kind === "tag" ? null : ref.name)
	if (ref.kind === "tag") {
		setCompareMode(false)
	}
}}
```
- When `activeBranch` changes and `compareBase` is null, resolve the default base once:
```tsx
useEffect(() => {
	if (activeBranch !== null && compareBase === null) {
		commands.defaultBranch(repo.path).then((b) => {
			if (b !== null) {
				setCompareBase(b)
			}
		})
	}
}, [activeBranch, compareBase, repo.path])
```
- (Import `commands` from `../ipc/bindings` if not already.)

- [ ] **Step 3: Header controls + panel swap**

In the header (only when `activeBranch !== null`): a "Compare with base" toggle button (`compareMode` on/off) and, when `compareMode`, a base `<select>` whose options are branch names. Get branch names via a `useRepoRefs(repo.path)` call in Workspace (import the hook) — build `const baseOptions = [...(refs?.local ?? []).map(b => b.name), ...(refs?.remotes ?? []).map(r => r.name)]`. The select value is `compareBase ?? ""`; `onChange` sets `compareBase`.
```tsx
{activeBranch !== null && (
	<div className="workspace-compare">
		<button
			type="button"
			className={`workspace-scope ${compareMode ? "is-on" : ""}`}
			title="Show only this branch's changes vs the base"
			onClick={() => setCompareMode((c) => !c)}
		>
			Compare with base
		</button>
		{compareMode && (
			<select
				className="workspace-base-select"
				value={compareBase ?? ""}
				onChange={(e) => setCompareBase(e.target.value)}
			>
				{compareBase === null && <option value="">base…</option>}
				{baseOptions.map((b) => (
					<option key={b} value={b}>
						{b}
					</option>
				))}
			</select>
		)}
	</div>
)}
```
- Bottom-left panel: swap based on compare mode. Where `<CommitDetail …/>` is rendered:
```tsx
{compareMode && activeBranch !== null && compareBase ? (
	<CompareDetail
		repoPath={repo.path}
		base={compareBase}
		head={activeBranch}
		onFileDiff={handleFileDiff}
	/>
) : (
	<CommitDetail
		repoPath={repo.path}
		selectedCommit={selected}
		onFileDiff={handleFileDiff}
	/>
)}
```
- When leaving compare mode or switching branch, the diff should reset: on `compareMode`/`activeBranch`/`compareBase` change, `handleFileDiff("", null)` is already called by whichever detail component's effect on mount/param change, so the DiffView clears — no extra wiring needed. (Import `CompareDetail`.)

- [ ] **Step 4: CSS**

In `src/workspace/Workspace.css` add:
```css
.workspace-compare {
	flex: none;
	display: flex;
	align-items: center;
	gap: 6px;
}
.workspace-scope.is-on {
	background: var(--accent);
	color: var(--accent-fg);
}
.workspace-base-select {
	height: 24px;
	max-width: 180px;
	border: 1px solid var(--border);
	border-radius: 6px;
	background: var(--bg);
	color: var(--fg);
	font-size: 12px;
}
```
(Place the compare controls sensibly in the header row — e.g. right after the scope toggle. Keep the header a single flex row; `.workspace-path` still flexes to absorb space.)

- [ ] **Step 5: Update App.test mock**

`Workspace` now also calls `commands.defaultBranch` (and `useRepoRefs` → `listRefs` again, already mocked). Add to the `commands` mock in `src/App.test.tsx`: `defaultBranch: vi.fn().mockResolvedValue(null)` (and `branchDiff`/`branchFileDiff: vi.fn().mockResolvedValue({ status: "ok", data: [] })` if referenced at mount). Existing assertions unchanged.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run build && cargo build --manifest-path src-tauri/Cargo.toml && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: compare-with-base toggle wired to branch-delta review"
```

---

## Self-Review

**Spec coverage (the user's request):**
- See a branch's changes to review MRs → Tasks 1–4 (`branch_diff`/`branch_file_diff` + `CompareDetail` in a compare mode) ✓
- Exclude main→feature merges (only the author's branch changes) → three-dot `base...head`, proven by the Task-1 test asserting the main-only `c.txt` is excluded ✓
- Base auto-detected + overridable → `default_branch` + the base `<select>` ✓
- Trigger = header toggle when a branch is active → Task 4 (`activeBranch` set on sidebar branch click; toggle appears; swaps panels) ✓

**Placeholder scan:** No TBD/TODO; complete code. "base…" is intended placeholder-option copy.

**Type consistency:** `Sidebar.onSelectRef` new `{ name, tip, kind }` shape updated in Sidebar + Workspace + Sidebar.test. `FileChange` reused. `defaultBranch` returns `string | null`; `branch_diff`/`branch_file_diff` are Result-wrapped, handled with the externally-tagged `GitError` (`"NonZero" in err`). `CompareDetail` mirrors `CommitDetail`'s guard pattern.

**Known risks flagged for execution:**
1. **`onSelectRef` signature change ripples** to Workspace + Sidebar.test — update all three together (Task 4 Step 1).
2. **Double `list_refs`**: Sidebar and Workspace both call `useRepoRefs` (for the base options); acceptable (cheap, logged). If it's noticeably wasteful later, lift `useRepoRefs` to Workspace and pass refs down.
3. **Base = head** (comparing the default branch to itself) → empty diff; the empty state covers it.
4. **Remote head names** (e.g. `origin/feature/x`) as `head`, and bases like `origin/main`, work with three-dot `git diff` since both resolve to commits. Detached/invalid refs surface as a `GitError` shown in `CompareDetail`'s error state.
5. **CompareDetail loop-safety**: mirrors the M2a `CommitDetail` fix (onFileDiff in a ref, effect deps exclude it) — do not reintroduce the infinite-loop bug by depending on `onFileDiff`.
