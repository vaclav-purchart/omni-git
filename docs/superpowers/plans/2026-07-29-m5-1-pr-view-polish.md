# Milestone 5.1 — PR-View Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the branch-compare / PR-review view discoverable and pleasant: a Compare button that's always visible (head defaults to the current branch), keyboard file navigation, an explicit Exit plus auto-exit on commit-click / re-target on branch-click, a clear visual treatment distinguishing compare mode, a searchable base picker, and a smart default base detected from the branch's fork point.

**Architecture:** A new Rust `fork_base` heuristic picks the branch `head` most likely diverged from (nearest merge-base among candidate branches) as the default compare base, falling back to `default_branch`. The frontend gets a small searchable `BranchPicker` combobox (replacing the `<select>`), `CompareDetail` gains the same arrow-key file nav as `CommitDetail`, and `Workspace` reworks the compare controls: always-visible toggle + Exit, head = active-or-current branch, commit-click exits compare, branch-click re-targets, and an accent "PR review" banner marks the mode. Builds on merged M5.

**Tech Stack:** Existing (Tauri 2, Rust, React 18, TS7, tauri-specta, Vitest, Biome). No new deps.

## Global Constraints

- **System git only** via `git::run::run`; three-dot compare stays `git diff base...head`. Never libgit2.
- **Frontend uses only generated bindings**; regenerate HEADLESSLY (`cargo test … export_bindings`); never `npm run tauri dev`; never commit `src/ipc/bindings.ts`.
- New command registers in the existing `collect_commands![...]`; no second Builder; `.events(...)` intact.
- Snake_case generated types; `Result`-wrapped commands; `GitError` externally-tagged.
- Preserve M5 correctness (three-dot semantics, `CompareDetail` loop-safety: `onFileDiff` in a ref, load effect deps exclude it) and all existing railway/graph/search behavior.
- TS7; Biome verbatim; theme-aware; frequent commits; author if unset `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.

## File Structure

- `src-tauri/src/git/compare.rs` (modify) — add `fork_base`.
- `src-tauri/src/commands/repo_read.rs`, `lib.rs` (modify) — expose `fork_base`.
- `src/ui/BranchPicker.tsx` + `.test.tsx` (new) — searchable branch combobox.
- `src/detail/CompareDetail.tsx` (modify) — keyboard file nav.
- `src/workspace/Workspace.tsx` + `.css` (modify) — always-visible toggle, Exit, head defaulting, exit/re-target on click, banner, BranchPicker, fork-base default.
- `src/App.test.tsx` (modify) — mock `forkBase`.

---

### Task 1: Fork-point base detection (backend, TDD)

Pick the candidate branch `head` most recently diverged from (its likely parent).

**Files:**
- Modify: `src-tauri/src/git/compare.rs`

**Interfaces:**
- Produces: `pub fn fork_base(app, repo_path, head: &str) -> Option<String>` — among local + remote branch short-names (excluding `head` and any ref whose tip equals `head`'s), returns the one whose `merge-base(candidate, head)` is nearest to `head` (smallest positive `rev-list --count <mergebase>..<head>`); ties prefer `default_branch`'s value; if none qualify, falls back to `default_branch`.

- [ ] **Step 1: Add a pure ranking helper + `fork_base`, with a test**

In `src-tauri/src/git/compare.rs` add:
```rust
/// Pure: given (candidate_name, commits_head_is_ahead_of_the_merge_base) pairs,
/// pick the candidate head most recently diverged from = smallest positive
/// ahead-count. `preferred` (the default branch) breaks ties. None if no
/// candidate has a positive ahead-count.
pub fn pick_fork_base(
	candidates: &[(String, u32)],
	preferred: Option<&str>,
) -> Option<String> {
	candidates
		.iter()
		.filter(|(_, ahead)| *ahead > 0)
		.min_by(|a, b| {
			a.1.cmp(&b.1).then_with(|| {
				let pa = preferred == Some(a.0.as_str());
				let pb = preferred == Some(b.0.as_str());
				// prefer the preferred branch on a tie
				pb.cmp(&pa)
			})
		})
		.map(|(name, _)| name.clone())
}

fn branch_names(app: &tauri::AppHandle, repo_path: &str) -> Vec<String> {
	let mut names = Vec::new();
	for scope in ["refs/heads", "refs/remotes"] {
		if let Ok(out) = run(app, repo_path, &["for-each-ref", "--format=%(refname:short)", scope]) {
			for line in out.lines() {
				let n = line.trim();
				if !n.is_empty() && !n.ends_with("/HEAD") {
					names.push(n.to_string());
				}
			}
		}
	}
	names
}

pub fn fork_base(app: &tauri::AppHandle, repo_path: &str, head: &str) -> Option<String> {
	let preferred = default_branch(app, repo_path);
	let mut ranked: Vec<(String, u32)> = Vec::new();
	for cand in branch_names(app, repo_path) {
		if cand == head {
			continue;
		}
		let mb = match run(app, repo_path, &["merge-base", &cand, head]) {
			Ok(s) => s.trim().to_string(),
			Err(_) => continue,
		};
		if mb.is_empty() {
			continue;
		}
		let range = format!("{}..{}", mb, head);
		let ahead = run(app, repo_path, &["rev-list", "--count", &range])
			.ok()
			.and_then(|s| s.trim().parse::<u32>().ok())
			.unwrap_or(0);
		ranked.push((cand, ahead));
	}
	pick_fork_base(&ranked, preferred.as_deref()).or(preferred)
}

#[cfg(test)]
mod fork_tests {
	use super::*;

	#[test]
	fn picks_nearest_diverged_candidate() {
		// feature forked from develop (ahead 1); develop forked from main (so
		// main's merge-base with feature is older → larger ahead-count).
		let ranked = vec![("main".to_string(), 3), ("develop".to_string(), 1)];
		assert_eq!(pick_fork_base(&ranked, Some("main")).as_deref(), Some("develop"));
	}

	#[test]
	fn tie_prefers_default() {
		let ranked = vec![("main".to_string(), 2), ("other".to_string(), 2)];
		assert_eq!(pick_fork_base(&ranked, Some("main")).as_deref(), Some("main"));
	}

	#[test]
	fn none_when_no_positive_ahead() {
		let ranked = vec![("main".to_string(), 0)];
		assert_eq!(pick_fork_base(&ranked, None), None);
	}
}
```
(The pure `pick_fork_base` is unit-tested directly — it holds the ranking logic; the git-driven `fork_base`/`branch_names` are thin I/O around it, consistent with how other AppHandle functions here are covered.)

- [ ] **Step 2: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::compare`
Expected: the new `fork_tests` (3) pass alongside the existing compare tests.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: fork-point base detection (nearest diverged branch)"
```

---

### Task 2: Expose `fork_base` via IPC

**Files:**
- Modify: `src-tauri/src/commands/repo_read.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces command `fork_base(repo_path, head) -> Option<String>` (`forkBase`).

- [ ] **Step 1: Wrapper + register**

Add to `src-tauri/src/commands/repo_read.rs`:
```rust
use crate::git::compare::fork_base as fb;

#[tauri::command]
#[specta::specta]
pub fn fork_base(app: tauri::AppHandle, repo_path: String, head: String) -> Option<String> {
	fb(&app, &repo_path, &head)
}
```
Append `commands::repo_read::fork_base` to the existing `collect_commands![...]` in `lib.rs`.

- [ ] **Step 2: Regenerate + verify**

Run: `cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`
Expected: `commands.forkBase(repoPath, head): Promise<string | null>` present.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: fork_base IPC command"
```

---

### Task 3: Searchable `BranchPicker` combobox

**Files:**
- Create: `src/ui/BranchPicker.tsx`, `src/ui/BranchPicker.test.tsx`

**Interfaces:**
- Produces: `<BranchPicker value={string} options={string[]} onChange={(v: string) => void} placeholder? />` — a button showing the current value that opens a small popover with a search input (auto-focused) filtering `options` (case-insensitive substring) and a scrollable list; clicking an option calls `onChange` and closes; Escape/click-outside closes.

- [ ] **Step 1: Write the failing test**

Create `src/ui/BranchPicker.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { BranchPicker } from "./BranchPicker"

const options = ["main", "develop", "feature/alpha", "feature/beta", "origin/main"]

describe("BranchPicker", () => {
	it("opens, filters, and selects", async () => {
		const onChange = vi.fn()
		render(<BranchPicker value="main" options={options} onChange={onChange} />)
		await userEvent.click(screen.getByRole("button", { name: /main/ }))
		const search = screen.getByPlaceholderText(/filter/i)
		await userEvent.type(search, "beta")
		// only the matching option is listed
		expect(screen.getByText("feature/beta")).toBeInTheDocument()
		expect(screen.queryByText("develop")).not.toBeInTheDocument()
		await userEvent.click(screen.getByText("feature/beta"))
		expect(onChange).toHaveBeenCalledWith("feature/beta")
	})

	it("closes on Escape", async () => {
		render(<BranchPicker value="main" options={options} onChange={vi.fn()} />)
		await userEvent.click(screen.getByRole("button", { name: /main/ }))
		expect(screen.getByPlaceholderText(/filter/i)).toBeInTheDocument()
		await userEvent.keyboard("{Escape}")
		expect(screen.queryByPlaceholderText(/filter/i)).not.toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/BranchPicker.test.tsx`
Expected: FAIL — cannot find `./BranchPicker`.

- [ ] **Step 3: Implement**

Create `src/ui/BranchPicker.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from "react"
import "./BranchPicker.css"

export function BranchPicker({
	value,
	options,
	onChange,
	placeholder,
}: {
	value: string
	options: string[]
	onChange: (v: string) => void
	placeholder?: string
}) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const rootRef = useRef<HTMLDivElement>(null)

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		return q === "" ? options : options.filter((o) => o.toLowerCase().includes(q))
	}, [query, options])

	useEffect(() => {
		if (!open) {
			return
		}
		function onDocDown(e: MouseEvent) {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false)
			}
		}
		document.addEventListener("mousedown", onDocDown)
		return () => document.removeEventListener("mousedown", onDocDown)
	}, [open])

	function choose(v: string) {
		onChange(v)
		setOpen(false)
		setQuery("")
	}

	return (
		<div className="branch-picker" ref={rootRef}>
			<button
				type="button"
				className="branch-picker-value"
				onClick={() => setOpen((o) => !o)}
				title={value || placeholder}
			>
				<span className="branch-picker-label">{value || placeholder || "select…"}</span>
				<span aria-hidden="true">▾</span>
			</button>
			{open && (
				<div className="branch-picker-pop">
					<input
						className="branch-picker-search"
						placeholder="Filter branches…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								setOpen(false)
							} else if (e.key === "Enter" && filtered.length > 0) {
								choose(filtered[0])
							}
						}}
						// biome-ignore lint/a11y/noAutofocus: popover search should focus on open
						autoFocus
					/>
					<ul className="branch-picker-list">
						{filtered.map((o) => (
							<li key={o}>
								<button
									type="button"
									className={`branch-picker-option ${o === value ? "is-selected" : ""}`}
									onClick={() => choose(o)}
									title={o}
								>
									{o}
								</button>
							</li>
						))}
						{filtered.length === 0 && (
							<li className="branch-picker-empty">No matches</li>
						)}
					</ul>
				</div>
			)}
		</div>
	)
}
```
Create `src/ui/BranchPicker.css`:
```css
.branch-picker {
	position: relative;
}
.branch-picker-value {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	max-width: 200px;
	height: 24px;
	padding: 0 8px;
	border: 1px solid var(--border);
	border-radius: 6px;
	background: var(--bg);
	color: var(--fg);
	font-size: 12px;
}
.branch-picker-label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.branch-picker-pop {
	position: absolute;
	z-index: 20;
	top: calc(100% + 4px);
	left: 0;
	width: 260px;
	max-width: 70vw;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 8px;
	box-shadow: var(--shadow-md);
	padding: 6px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.branch-picker-search {
	height: 28px;
	padding: 0 8px;
	border: 1px solid var(--border);
	border-radius: 6px;
	background: var(--bg);
	color: var(--fg);
}
.branch-picker-list {
	list-style: none;
	margin: 0;
	padding: 0;
	max-height: 240px;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
}
.branch-picker-option {
	width: 100%;
	text-align: left;
	padding: 5px 8px;
	border: none;
	background: none;
	color: var(--fg);
	border-radius: 6px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 13px;
}
.branch-picker-option:hover {
	background: var(--surface-hover);
}
.branch-picker-option.is-selected {
	color: var(--accent);
	font-weight: 600;
}
.branch-picker-empty {
	padding: 6px 8px;
	color: var(--muted);
	font-size: 12px;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/ui/BranchPicker.test.tsx`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: searchable BranchPicker combobox"
```

---

### Task 4: CompareDetail keyboard file navigation

Give the compare file list the same arrow-key nav (+ scroll-into-view) as `CommitDetail`.

**Files:**
- Modify: `src/detail/CompareDetail.tsx`

- [ ] **Step 1: Add keyboard nav**

Mirror `CommitDetail`'s pattern in `CompareDetail`:
- Add `const activeRef = useRef<HTMLButtonElement>(null)` and an effect `useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest" }) }, [activePath])`.
- Add `moveFile(delta)` (find `activePath` index in `files`; clamp; `openFile(files[next].path)`) and `onKeyDown` handling ArrowDown/ArrowUp (preventDefault + moveFile) — identical logic to `CommitDetail`.
- On the container `<div className="detail">`, add `tabIndex={0} role="listbox" aria-label="Changed files" onKeyDown={onKeyDown}`.
- On the active file `<button>`, add `ref={activePath === f.path ? activeRef : undefined}`.
(Keep the error/empty states and the genRef/reqRef/onFileDiffRef loop-safe pattern exactly.)

- [ ] **Step 2: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: keyboard file navigation in CompareDetail"
```

---

### Task 5: Workspace PR-view UX (always-visible, exit, banner, picker, fork default)

**Files:**
- Modify: `src/workspace/Workspace.tsx`, `src/workspace/Workspace.css`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `BranchPicker` (Task 3), `commands.forkBase` (Task 2).

- [ ] **Step 1: Rework compare state + head defaulting**

In `src/workspace/Workspace.tsx`:
- `useRepoRefs(repo.path)` already provides `refs`. Compute `const currentBranch = refs?.current ?? null` and `const compareHead = activeBranch ?? currentBranch`.
- Keep `compareMode`, `compareBase`, `activeBranch`.
- **Head defaulting**: the Compare button is now ALWAYS shown (when a repo is open). When toggled on, head = `compareHead` (active-or-current branch).
- **Default base via fork point**: replace the M5 `defaultBranch` effect with one that resolves the base from the fork point when entering compare and no base is chosen yet:
```tsx
useEffect(() => {
	if (compareMode && compareHead !== null && compareBase === null) {
		commands.forkBase(repo.path, compareHead).then((b) => {
			if (b !== null) {
				setCompareBase(b)
			}
		})
	}
}, [compareMode, compareHead, compareBase, repo.path])
```

- [ ] **Step 2: Exit + click-reset wiring**

- Sidebar `onSelectRef`: keep `setSelectHash(ref.tip)` and `setActiveBranch(ref.kind === "tag" ? null : ref.name)`; ADD: when a branch is clicked while `compareMode`, re-target by resetting the base so the fork-point re-resolves for the new head — `setCompareBase(null)`. (Head follows `activeBranch` automatically.) For a tag, `setCompareMode(false)`.
- Railway `onSelect` (commit click): wrap `setSelected` to ALSO exit compare — `onSelect={(c) => { setSelected(c); setCompareMode(false) }}`. (Clicking a commit means "inspect this commit", so leave PR view.)
- Add an explicit **Exit**: in the compare controls, when `compareMode`, an ✕ button → `setCompareMode(false)`.

- [ ] **Step 3: Header controls (always-visible toggle + picker + exit)**

Replace the `activeBranch !== null` gate so the compare toggle shows whenever `compareHead !== null` (i.e. a repo with a current branch). Use `BranchPicker` for the base:
```tsx
{compareHead !== null && (
	<div className="workspace-compare">
		<button
			type="button"
			className={`workspace-scope ${compareMode ? "is-on" : ""}`}
			title={`Review only ${compareHead}'s changes vs a base branch`}
			onClick={() => setCompareMode((c) => !c)}
		>
			{compareMode ? `Reviewing ${compareHead}` : "Compare with base"}
		</button>
		{compareMode && (
			<>
				<span className="workspace-compare-vs">vs</span>
				<BranchPicker
					value={compareBase ?? ""}
					options={baseOptions}
					onChange={(b) => setCompareBase(b)}
					placeholder="base…"
				/>
				<button
					type="button"
					className="btn btn-icon workspace-compare-exit"
					title="Exit review"
					aria-label="Exit review"
					onClick={() => setCompareMode(false)}
				>
					✕
				</button>
			</>
		)}
	</div>
)}
```
`baseOptions` stays `[...(refs?.local ?? []).map(b => b.name), ...(refs?.remotes ?? []).map(r => r.name)]`.

- [ ] **Step 4: Panel swap + visual distinction**

- Panel swap condition becomes `compareMode && compareHead !== null && compareBase`:
```tsx
{compareMode && compareHead !== null && compareBase ? (
	<CompareDetail repoPath={repo.path} base={compareBase} head={compareHead} onFileDiff={handleFileDiff} />
) : (
	<CommitDetail repoPath={repo.path} selectedCommit={selected} onFileDiff={handleFileDiff} />
)}
```
- **Visual distinction**: add a `compare-mode` class to the workspace-main region (or the files+diff column wrappers) when `compareMode`, giving the compare panels an accent top border + a tinted files-panel banner. Simplest: wrap the bottom files Panel content with a class and style it. Add to the bottom-left `.ws-pane` (files) a conditional class, e.g. render `<div className={`ws-fill ${compareMode ? "is-compare" : ""}`}>` around CommitDetail/CompareDetail, or add the class on the Panel. Add CSS:
```css
.workspace-compare-vs {
	color: var(--muted);
	font-size: 12px;
}
.workspace-scope.is-on {
	background: var(--accent);
	color: var(--accent-fg);
}
/* PR-review visual cue */
.is-compare {
	box-shadow: inset 0 2px 0 var(--accent);
}
.compare-badge {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 2px 8px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--accent) 18%, transparent);
	color: var(--accent);
	font-size: 11px;
	font-weight: 600;
}
```
Apply `is-compare` to the files panel wrapper (and optionally the diff panel) when `compareMode`. `CompareDetail`'s existing `head ← base` subject already labels it; make that subject use the `.compare-badge` look by adding the class in CompareDetail's subject (optional small tweak — or leave as-is if out of scope).

- [ ] **Step 5: App.test mock**

Add `forkBase: vi.fn().mockResolvedValue(null)` to the `commands` mock in `src/App.test.tsx` (Workspace calls it on compare-enter; harmless at mount since compareMode starts false). Existing assertions unchanged.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run build && cargo build --manifest-path src-tauri/Cargo.toml && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: PR view always-visible, exit + click-reset, banner, searchable base, fork default"
```

---

## Self-Review

**Spec coverage (the user's requests):**
- Compare button always visible → Task 5 (`compareHead !== null` gate, head defaults to current branch) ✓
- Keyboard nav in compare files → Task 4 ✓
- Exit button + exit-on-commit-click + reset-on-branch-click → Task 5 Step 2 ✓
- Visually distinguish PR view → Task 5 Step 4 (`is-compare` accent + "Reviewing X" toggle label + badge) ✓
- Searchable base picker → Task 3 (`BranchPicker`) ✓
- Fork-point default base → Tasks 1–2 (`fork_base`) + Task 5 (used as the default) ✓

**Placeholder scan:** No TBD/TODO; complete code. "base…", "No matches" are intended UI copy.

**Type consistency:** `fork_base(repo_path, head) -> Option<String>` (`forkBase`) matches its use. `BranchPicker` props consistent between component, test, and Workspace usage. `compareHead` = `activeBranch ?? currentBranch` threaded to both the fork-base effect and CompareDetail's `head`.

**Known risks / notes:**
1. **Head defaulting to current branch**: when nothing is clicked, "Compare with base" reviews the current branch vs its fork base — a sensible default; if the repo is in detached HEAD, `refs.current` is null → `compareHead` null → button hidden (acceptable).
2. **Re-target on branch click** resets `compareBase` to null so the fork base re-resolves for the new head; if the user had manually picked a base, that choice is dropped on branch switch (acceptable; matches "reset it").
3. **`fork_base` heuristic** is best-effort (nearest diverged branch); can mis-pick in unusual topologies, but it's only the *default* and is overridable via the searchable picker. The pure `pick_fork_base` is unit-tested; the git-driven wrapper follows the existing AppHandle-not-unit-tested convention.
4. **BranchPicker click-outside** uses a document mousedown listener added only while open, removed on close/unmount — no leak.
