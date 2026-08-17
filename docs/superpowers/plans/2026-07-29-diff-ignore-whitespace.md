# Diff Viewer — Ignore Whitespace Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Ignore whitespace" toggle to the diff viewer so lines differing only in whitespace (e.g. added indentation/tabs, same text) aren't shown as changes — using `git diff -w` / `git show -w` (`--ignore-all-space`).

**Architecture:** The two backend diff commands gain an `ignore_whitespace: bool` param that inserts `-w` into the git args. The frontend holds the toggle state in `Workspace`, passes it into `CommitDetail`/`CompareDetail` (which forward it to `fileDiff`/`branchFileDiff` and re-fetch the open file when it flips), and renders the toggle control in the `DiffView` header bar. When a change is whitespace-only, `-w` yields an empty patch → the existing "No textual changes to display" empty state shows.

**Tech Stack:** Existing — Tauri 2, Rust (system git via `git::run::run`), React/TS 7, tauri-specta bindings. No new deps.

## Global Constraints

- **System git only**; all git through `git::run::run`. Whitespace mode is `-w` (`--ignore-all-space`), the SourceTree-style "ignore all whitespace".
- **Frontend uses only generated bindings**; regenerate HEADLESSLY (`cargo test --manifest-path src-tauri/Cargo.toml export_bindings`); never `npm run tauri dev`; never commit `src/ipc/bindings.ts`.
- Specta types are snake_case; the new param serializes as `ignore_whitespace` in the type but the generated TS command method takes a camelCase `ignoreWhitespace` positional arg — call sites use whatever the generated `commands.fileDiff(...)` signature shows (regenerate, then match it).
- TS7; Biome verbatim; theme-aware; author if unset `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.
- Preserve the existing loop-safe load pattern in `CommitDetail`/`CompareDetail` (genRef/reqRef stale-guards; `onFileDiff` held in a ref; load effect deps exclude the callback).

## File Structure

- `src-tauri/src/git/changes.rs` (modify) — `file_diff` gains `ignore_whitespace: bool`; add `-w` when set; +test.
- `src-tauri/src/git/compare.rs` (modify) — `branch_file_diff` gains `ignore_whitespace: bool`; +test.
- `src-tauri/src/commands/repo_read.rs` (modify) — `file_diff` + `branch_file_diff` command wrappers gain the param and forward it.
- `src/detail/CommitDetail.tsx` (modify) — accept `ignoreWhitespace` prop, forward to `fileDiff`, re-fetch open file when it flips.
- `src/detail/CompareDetail.tsx` (modify) — same for `branchFileDiff`.
- `src/diff/DiffView.tsx` (modify) — always-visible header toolbar with the toggle; new `ignoreWhitespace` + `onToggleIgnoreWhitespace` props.
- `src/diff/DiffView.css` (modify) — style the toggle.
- `src/workspace/Workspace.tsx` (modify) — `ignoreWhitespace` state; pass to the two detail components + DiffView.

---

### Task 1: Backend — `ignore_whitespace` param on both diff commands

**Files:**
- Modify: `src-tauri/src/git/changes.rs`, `src-tauri/src/git/compare.rs`, `src-tauri/src/commands/repo_read.rs`

**Interfaces:**
- Produces:
  - `changes::file_diff(app, repo_path, hash, path, ignore_whitespace: bool) -> Result<String, GitError>`
  - `compare::branch_file_diff(app, repo_path, base, head, path, ignore_whitespace: bool) -> Result<String, GitError>`
  - Commands `file_diff` / `branch_file_diff` gain a trailing `ignore_whitespace: bool` arg (generated TS: `commands.fileDiff(repoPath, hash, path, ignoreWhitespace)` and `commands.branchFileDiff(repoPath, base, head, path, ignoreWhitespace)` — confirm exact shape after regenerating).

- [ ] **Step 1: Failing test for `branch_file_diff` in `compare.rs`**

The `compare.rs` test module already has a `git(dir, args)` helper and builds temp repos. Add a test that a whitespace-only change (re-indent a line) produces a NON-empty patch without the flag and an EMPTY patch with it. Add to the `#[cfg(test)] mod tests` in `src-tauri/src/git/compare.rs`:
```rust
#[test]
fn ignore_whitespace_hides_indent_only_change() {
	// Build a repo where `head` re-indents a line vs `base` with no textual change.
	let tmp = tempfile::tempdir().unwrap();
	let dir = tmp.path();
	git(dir, &["init", "-q", "-b", "main"]);
	git(dir, &["config", "user.email", "t@t"]);
	git(dir, &["config", "user.name", "t"]);
	std::fs::write(dir.join("f.txt"), "hello\nworld\n").unwrap();
	git(dir, &["add", "."]);
	git(dir, &["commit", "-qm", "base"]);
	git(dir, &["checkout", "-q", "-b", "feat"]);
	// Same text, only leading whitespace added.
	std::fs::write(dir.join("f.txt"), "\thello\n\tworld\n").unwrap();
	git(dir, &["add", "."]);
	git(dir, &["commit", "-qm", "reindent"]);

	let repo = dir.to_str().unwrap();
	// NOTE: these call the pure git-arg path; if branch_file_diff needs an
	// AppHandle, assert instead via a raw `git diff` command with/without -w
	// (see fallback below).
}
```
IMPORTANT: `branch_file_diff` takes `&tauri::AppHandle`, which isn't available in a unit test. Look at how the EXISTING `compare.rs` tests exercise functions that need `run`/`AppHandle` — they test the pure helpers (`pick_fork_base`, `three_dot_range`) directly and shell out with the `git()` helper for repo setup. So do NOT try to call `branch_file_diff` in the test. Instead, assert the FLAG BEHAVIOR at the git level to lock the contract: run `git -C <dir> diff -w main...feat -- f.txt` and `git -C <dir> diff main...feat -- f.txt` via `std::process::Command` and assert the first is empty (or has no `+`/`-` body lines) and the second is not. This proves `-w` does what we rely on. Name it `dash_w_hides_indent_only_change`. (If `tempfile` isn't already a dev-dependency, check `compare.rs`'s existing tests for how they make temp dirs and reuse that mechanism rather than adding a dep.)

- [ ] **Step 2: Run it, watch it fail / confirm the contract**

Run: `cargo test --manifest-path src-tauri/Cargo.toml dash_w_hides_indent_only_change -- --nocapture`
Expected: the assertions describe the `-w` contract; if the test is purely a git-level assertion it may pass immediately (that's fine — it documents/locks the behavior we build on). Proceed.

- [ ] **Step 3: Add the param to the git-module functions**

In `src-tauri/src/git/changes.rs`, change `file_diff` to accept `ignore_whitespace: bool` and build args conditionally:
```rust
pub fn file_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	hash: &str,
	path: &str,
	ignore_whitespace: bool,
) -> Result<String, GitError> {
	// `show --format=` suppresses the commit header, leaving just the patch.
	let mut args = vec!["show", "--format=", "--patch"];
	if ignore_whitespace {
		args.push("-w");
	}
	args.push(hash);
	args.push("--");
	args.push(path);
	run(app, repo_path, &args)
}
```
In `src-tauri/src/git/compare.rs`, change `branch_file_diff`:
```rust
pub fn branch_file_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	base: &str,
	head: &str,
	path: &str,
	ignore_whitespace: bool,
) -> Result<String, GitError> {
	let range = three_dot_range(base, head);
	let mut args = vec!["diff", "--no-color"];
	if ignore_whitespace {
		args.push("-w");
	}
	args.push(&range);
	args.push("--");
	args.push(path);
	run(app, repo_path, &args)
}
```
(Adapt to the exact borrow/lifetime shape the compiler wants — `range` is a local `String`, so push `&range` after it's bound, as shown.)

- [ ] **Step 4: Thread the param through the command wrappers**

In `src-tauri/src/commands/repo_read.rs`, add `ignore_whitespace: bool` to the `file_diff` and `branch_file_diff` command signatures and pass it to `gd(...)` / `bfd(...)`:
```rust
pub fn file_diff(
	app: tauri::AppHandle,
	repo_path: String,
	hash: String,
	path: String,
	ignore_whitespace: bool,
) -> Result<String, GitError> {
	gd(&app, &repo_path, &hash, &path, ignore_whitespace)
}
```
```rust
pub fn branch_file_diff(
	app: tauri::AppHandle,
	repo_path: String,
	base: String,
	head: String,
	path: String,
	ignore_whitespace: bool,
) -> Result<String, GitError> {
	bfd(&app, &repo_path, &base, &head, &path, ignore_whitespace)
}
```

- [ ] **Step 5: Build, test, regenerate bindings**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`
Expected: all backend tests pass (incl. the new one); `npm run build` FAILS with type errors at the `fileDiff`/`branchFileDiff` call sites (they now need the extra arg) — that is EXPECTED and fixed in Task 2. If `npm run build` fails ONLY for that reason, Task 1 is done; if it fails for any other reason, fix it. Confirm `src/ipc/bindings.ts` now shows the extra `ignoreWhitespace` param on both methods.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: ignore_whitespace param on file_diff/branch_file_diff (-w)"
```

---

### Task 2: Frontend — toggle in the diff viewer, wired to re-fetch

**Files:**
- Modify: `src/workspace/Workspace.tsx`, `src/detail/CommitDetail.tsx`, `src/detail/CompareDetail.tsx`, `src/diff/DiffView.tsx`, `src/diff/DiffView.css`

**Interfaces:**
- Consumes: `commands.fileDiff(repoPath, hash, path, ignoreWhitespace)`, `commands.branchFileDiff(repoPath, base, head, path, ignoreWhitespace)` (exact camelCase per regenerated bindings).

- [ ] **Step 1: Workspace holds the toggle state**

In `src/workspace/Workspace.tsx`, add near the other `useState`s (e.g. by `diff`/`diffPath`):
```tsx
const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
```
Pass `ignoreWhitespace={ignoreWhitespace}` to BOTH `<CommitDetail .../>` and `<CompareDetail .../>` (in the bottom panel, where `onFileDiff={handleFileDiff}` is passed). Pass to `<DiffView .../>`:
```tsx
<DiffView
	diff={diff}
	path={diffPath}
	ignoreWhitespace={ignoreWhitespace}
	onToggleIgnoreWhitespace={() => setIgnoreWhitespace((v) => !v)}
/>
```

- [ ] **Step 2: `CommitDetail` forwards the flag and re-fetches on toggle**

In `src/detail/CommitDetail.tsx`: add `ignoreWhitespace: boolean` to the props type and destructure it. In `openFile`, pass it to the command:
```tsx
const r = await commands.fileDiff(
	repoPath,
	selectedCommit.hash,
	path,
	ignoreWhitespace,
)
```
Add a re-fetch effect so flipping the toggle updates the currently-open file's diff. Place it after `openFile` is defined:
```tsx
// Re-fetch the open file's diff when the whitespace mode flips.
// biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on toggle
useEffect(() => {
	if (activePath !== null) {
		void openFile(activePath)
	}
}, [ignoreWhitespace])
```
(The existing genRef/reqRef guards make this safe: same commit → same gen, reqRef bumps so the re-fetch wins. Do NOT alter the main load effect's deps.)

- [ ] **Step 3: `CompareDetail` — same treatment**

In `src/detail/CompareDetail.tsx`: add `ignoreWhitespace: boolean` prop; pass it to `commands.branchFileDiff(repoPath, base, head, path, ignoreWhitespace)`; add the same re-fetch effect (guarded by `activePath !== null`, dep `[ignoreWhitespace]`, with the same biome-ignore comment).

- [ ] **Step 4: `DiffView` — always-visible header toolbar with the toggle**

In `src/diff/DiffView.tsx`, extend the props:
```tsx
export function DiffView({
	diff,
	path,
	ignoreWhitespace,
	onToggleIgnoreWhitespace,
}: {
	diff: string
	path?: string | null
	ignoreWhitespace: boolean
	onToggleIgnoreWhitespace: () => void
}) {
```
Change the header so it ALWAYS renders a toolbar row (currently it only renders when `path` is set): the path + stats on the left when `path` is present, and the toggle button on the right always. Replace the `{path && (<div className="diff-header">…</div>)}` block with:
```tsx
<div className="diff-header">
	{path ? (
		<>
			<MiddlePath path={path} className="diff-header-path" />
			<span className="diff-header-stats">
				<span className="diff-stat-add">+{stats.add}</span>
				<span className="diff-stat-del">−{stats.del}</span>
			</span>
		</>
	) : (
		<span className="diff-header-path diff-header-path--empty" />
	)}
	<button
		type="button"
		className={`diff-ws-toggle ${ignoreWhitespace ? "is-on" : ""}`}
		title="Ignore whitespace changes (-w)"
		aria-pressed={ignoreWhitespace}
		onClick={onToggleIgnoreWhitespace}
	>
		Ignore whitespace
	</button>
</div>
```
(Keep `MiddlePath` imported. The stats `useMemo`/scroll-reset effect are unchanged.)

- [ ] **Step 5: Style the toggle**

In `src/diff/DiffView.css`, add rules consistent with the app's tokens/other buttons (e.g. `.detail-hide-tests`). Push the toggle to the right (e.g. give `.diff-header` `display:flex; align-items:center; gap:8px;` if not already, and the path a `margin-right:auto` or a spacer). Style `.diff-ws-toggle` as a small bordered button using `var(--border)`/`var(--muted)`, and `.diff-ws-toggle.is-on` using `var(--accent)` to show the active state. Match the existing header height so the toolbar doesn't grow. Verify against the current `.diff-header` rules already in the file and adjust rather than duplicate.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run build && cargo build --manifest-path src-tauri/Cargo.toml && npm run lint`
Expected: all green. (`App.test.tsx` mocks `commands.fileDiff` as a `vi.fn`, so the extra positional arg is harmless; if any test asserts exact call args for `fileDiff`/`branchFileDiff`, update it to include the new `ignoreWhitespace` arg.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: ignore-whitespace toggle in the diff viewer"
```

---

## Self-Review

**Spec coverage:**
- Toggle to ignore whitespace changes → Task 2 (DiffView toggle + Workspace state) ✓
- Lines differing only by whitespace not highlighted → Task 1 (`-w` on both diff commands); whitespace-only change → empty patch → existing empty state ✓
- Works in both commit view and PR/compare view → CommitDetail + CompareDetail both threaded ✓
- Persists across file clicks within a view → state lives in Workspace ✓

**Placeholder scan:** none.

**Type consistency:** `ignore_whitespace: bool` added to both git fns + both command wrappers (Task 1); `ignoreWhitespace: boolean` prop on CommitDetail/CompareDetail/DiffView and `ignoreWhitespace` state in Workspace (Task 2). Command call sites use the regenerated camelCase signature.

**Known risks:**
1. **`git show -w`** — `git show` accepts diff options including `-w`; a whitespace-only change yields an empty patch (desired). Verified conceptually; the Rust test locks the `git diff -w` contract at the git level (the same `-w` semantics `git show` uses for its patch).
2. **Re-fetch effect dep** — depends only on `[ignoreWhitespace]` with a biome-ignore for exhaustive-deps; intentional. Safe because the genRef/reqRef guards already handle overlapping fetches within the same commit/compare.
3. **State scope** — toggle state is in-memory (not persisted to localStorage). Matches the minimal ask; a persisted preference is a trivial future add if wanted.
4. **File list unaffected** — `commit_files`/`branch_diff` (name-status) intentionally NOT changed, so a whitespace-only-changed file still appears in the list but shows "No textual changes to display" when opened with the toggle on. This is acceptable/expected behavior, not a bug.
