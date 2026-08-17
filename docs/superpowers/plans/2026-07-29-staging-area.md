# Staging Area (Whole-File Write Ops) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add whole-file stage / unstage / stage-all / unstage-all / discard to the working-copy view — the first git write operations.

**Architecture:** Five backend mutation commands (system git via `git::run`) returning `Result<(), GitError>`. The frontend extends `WorkingCopyDetail` with a top toolbar + per-file action buttons + a confirm modal for destructive discard, and after each successful mutation calls `onMutated()` → Workspace `refresh()` (bumps `refreshKey`, remounting the detail + railway pinned row → fresh `working_status`).

**Tech Stack:** Existing. No new deps.

**Spec:** `docs/superpowers/specs/2026-07-29-staging-area-design.md`.

## Global Constraints

- **System git only**, all via `git::run::run` (logs to console + M2c ring buffer). No libgit2.
- **Frontend uses only generated bindings**; regenerate HEADLESSLY (`cargo test --manifest-path src-tauri/Cargo.toml export_bindings`); never `npm run tauri dev`; never commit `src/ipc/bindings.ts`.
- New commands register in `collect_commands!` on the single builder.
- TS7; Biome verbatim; theme-aware (CSS vars only); frequent commits; author if unset `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.
- **Whole-file only.** Discard is destructive → confirm modal required; discard on an Unstaged row uses `git restore --worktree` (unstaged edits only, keeps staged); no discard-all.
- Preserve `WorkingCopyDetail`'s loop-safe pattern (genRef/reqRef, onFileDiff-in-ref, aliveRef unmount guard, main load effect deps `[repoPath]`).

## File Structure

- `src-tauri/src/git/stage.rs` (new) — mutation git-fns (`stage_file`, `unstage_file`, `stage_all`, `unstage_all`, `discard_file`) + integration tests.
- `src-tauri/src/git/mod.rs` (modify) — `pub mod stage;`.
- `src-tauri/src/commands/repo_write.rs` (new) — `#[tauri::command]` wrappers.
- `src-tauri/src/commands/mod.rs` (modify) — `pub mod repo_write;`.
- `src-tauri/src/lib.rs` (modify) — register the 5 commands in `collect_commands!`.
- `src/ui/ConfirmDialog.tsx` (new) + `src/ui/ConfirmDialog.css` (new) — reusable confirm modal.
- `src/detail/WorkingCopyDetail.tsx` (modify) — toolbar, per-file buttons, confirm wiring, `onMutated`.
- `src/detail/WorkingCopyDetail.css` (modify) — button + toolbar styling.
- `src/workspace/Workspace.tsx` (modify) — pass `onMutated={refresh}` to `WorkingCopyDetail`.

---

### Task 1: Backend — mutation commands

**Files:**
- Create: `src-tauri/src/git/stage.rs`
- Modify: `src-tauri/src/git/mod.rs`, `src-tauri/src/commands/repo_write.rs` (new), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces (git-module fns, each `-> Result<(), GitError>`):
  - `stage_file(app, repo_path, path)` → `git add -- <path>`
  - `unstage_file(app, repo_path, path)` → `git restore --staged -- <path>`
  - `stage_all(app, repo_path)` → `git add -A`
  - `unstage_all(app, repo_path)` → `git restore --staged .`
  - `discard_file(app, repo_path, path, untracked: bool)` → untracked: `git clean -f -- <path>`; else `git restore --worktree -- <path>`
- Commands (same names) in `commands::repo_write`, registered as `commands::repo_write::<name>` → generated TS `stageFile(repoPath, path)`, `unstageFile(repoPath, path)`, `stageAll(repoPath)`, `unstageAll(repoPath)`, `discardFile(repoPath, path, untracked)`.

- [ ] **Step 1: Write the git-module fns + a failing integration test**

Create `src-tauri/src/git/stage.rs`. The fns discard `run`'s stdout on success:
```rust
use crate::git::run::{run, GitError};

pub fn stage_file(app: &tauri::AppHandle, repo_path: &str, path: &str) -> Result<(), GitError> {
	run(app, repo_path, &["add", "--", path]).map(|_| ())
}

pub fn unstage_file(app: &tauri::AppHandle, repo_path: &str, path: &str) -> Result<(), GitError> {
	run(app, repo_path, &["restore", "--staged", "--", path]).map(|_| ())
}

pub fn stage_all(app: &tauri::AppHandle, repo_path: &str) -> Result<(), GitError> {
	run(app, repo_path, &["add", "-A"]).map(|_| ())
}

pub fn unstage_all(app: &tauri::AppHandle, repo_path: &str) -> Result<(), GitError> {
	run(app, repo_path, &["restore", "--staged", "."]).map(|_| ())
}

pub fn discard_file(
	app: &tauri::AppHandle,
	repo_path: &str,
	path: &str,
	untracked: bool,
) -> Result<(), GitError> {
	let args: Vec<&str> = if untracked {
		vec!["clean", "-f", "--", path]
	} else {
		vec!["restore", "--worktree", "--", path]
	};
	run(app, repo_path, &args).map(|_| ())
}
```
Add `pub mod stage;` to `src-tauri/src/git/mod.rs`.

Add integration tests (these fns need an `AppHandle`, so — following `compare.rs`'s convention — assert the EFFECT at the git level by shelling out with a `git(dir, args)` helper + a `status(dir) -> String` helper that returns `git status --porcelain`; reuse the same temp-repo mechanism `compare.rs` uses, no new dep). Cover:
- `stage_then_status_shows_staged`: build a repo with a committed file, modify it (` M`), run `git add -- f.txt`, assert `git status --porcelain` shows `M ` (staged).
- `unstage_then_status_shows_unstaged`: stage a modification, run `git restore --staged -- f.txt`, assert it's back to ` M`.
- `stage_all_stages_untracked_and_modified`: with a modified tracked + an untracked file, `git add -A`, assert both staged (no `??`, no ` M`).
- `unstage_all_clears_index`: stage everything, `git restore --staged .`, assert nothing staged.
- `discard_unstaged_keeps_staged`: THE key semantic test. Make a file, commit; then make TWO changes: stage one state, then further-modify the worktree (so it's `MM`). Run `git restore --worktree -- f.txt`; assert the worktree change is gone (Y cleared) but the STAGED change remains (X still `M`). (Construct via: commit "a\n"; write "b\n" + `git add`; write "c\n" (now `MM`, staged=b vs HEAD, worktree=c vs b); `git restore --worktree` → worktree becomes "b\n" (the staged content), status `M ` staged-only.)
- `discard_untracked_deletes_file`: create an untracked file, `git clean -f -- u.txt`, assert the file no longer exists on disk and is gone from status.

Since the fns themselves need an AppHandle, these tests assert the raw git behavior (the exact commands the fns run), locking the semantics the fns depend on — same approach as the existing `compare.rs`/`working.rs` tests.

- [ ] **Step 2: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml stage:: -- --nocapture`
Expected: all new tests PASS (they assert real git behavior).

- [ ] **Step 3: Command wrappers**

Create `src-tauri/src/commands/repo_write.rs`:
```rust
use crate::git::run::GitError;
use crate::git::stage;

#[tauri::command]
#[specta::specta]
pub fn stage_file(app: tauri::AppHandle, repo_path: String, path: String) -> Result<(), GitError> {
	stage::stage_file(&app, &repo_path, &path)
}

#[tauri::command]
#[specta::specta]
pub fn unstage_file(app: tauri::AppHandle, repo_path: String, path: String) -> Result<(), GitError> {
	stage::unstage_file(&app, &repo_path, &path)
}

#[tauri::command]
#[specta::specta]
pub fn stage_all(app: tauri::AppHandle, repo_path: String) -> Result<(), GitError> {
	stage::stage_all(&app, &repo_path)
}

#[tauri::command]
#[specta::specta]
pub fn unstage_all(app: tauri::AppHandle, repo_path: String) -> Result<(), GitError> {
	stage::unstage_all(&app, &repo_path)
}

#[tauri::command]
#[specta::specta]
pub fn discard_file(
	app: tauri::AppHandle,
	repo_path: String,
	path: String,
	untracked: bool,
) -> Result<(), GitError> {
	stage::discard_file(&app, &repo_path, &path, untracked)
}
```
Add `pub mod repo_write;` to `src-tauri/src/commands/mod.rs` (match how `repo_read` is declared).

- [ ] **Step 4: Register the commands**

In `src-tauri/src/lib.rs`, add to `collect_commands![...]`: `commands::repo_write::stage_file`, `commands::repo_write::unstage_file`, `commands::repo_write::stage_all`, `commands::repo_write::unstage_all`, `commands::repo_write::discard_file`.

- [ ] **Step 5: Build, test, regenerate bindings**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`
Expected: all pass; `src/ipc/bindings.ts` shows `stageFile(repoPath, path)`, `unstageFile(repoPath, path)`, `stageAll(repoPath)`, `unstageAll(repoPath)`, `discardFile(repoPath, path, untracked)`, each returning `Promise<Result<null, GitError>>`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: stage/unstage/stage-all/unstage-all/discard write commands"
```

---

### Task 2: Frontend — actions in `WorkingCopyDetail` + confirm modal

**Files:**
- Create: `src/ui/ConfirmDialog.tsx`, `src/ui/ConfirmDialog.css`
- Modify: `src/detail/WorkingCopyDetail.tsx`, `src/detail/WorkingCopyDetail.css`, `src/workspace/Workspace.tsx`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `commands.stageFile/unstageFile/stageAll/unstageAll/discardFile`.
- Produces: `<ConfirmDialog open message confirmLabel onConfirm onCancel />`; `WorkingCopyDetail` gains prop `onMutated: () => void`.

- [ ] **Step 1: `ConfirmDialog` component**

Create `src/ui/ConfirmDialog.tsx` — a small theme-aware modal overlay:
```tsx
import "./ConfirmDialog.css"

export function ConfirmDialog({
	open,
	message,
	confirmLabel,
	onConfirm,
	onCancel,
}: {
	open: boolean
	message: string
	confirmLabel: string
	onConfirm: () => void
	onCancel: () => void
}) {
	if (!open) {
		return null
	}
	return (
		<div className="confirm-overlay" onClick={onCancel} role="presentation">
			<div
				className="confirm-dialog"
				role="alertdialog"
				aria-modal="true"
				onClick={(e) => e.stopPropagation()}
			>
				<p className="confirm-message">{message}</p>
				<div className="confirm-actions">
					<button type="button" className="confirm-cancel" onClick={onCancel}>
						Cancel
					</button>
					<button
						type="button"
						className="confirm-danger"
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	)
}
```
Create `src/ui/ConfirmDialog.css`: fixed full-screen overlay (semi-transparent scrim), centered dialog using `var(--surface)`/`var(--border)`/`var(--fg)`; `.confirm-danger` uses the EXISTING danger tokens already defined in `src/theme/theme.css` for both light and dark — `--danger-bg`, `--danger-fg`, `--danger-border` (do NOT add a new token). Theme tokens only, no hardcoded colors.

- [ ] **Step 2: Add `onMutated` + actions to `WorkingCopyDetail`**

In `src/detail/WorkingCopyDetail.tsx`:
- Add `onMutated: () => void` to the props type + destructure.
- Import `ConfirmDialog`. Add state `const [confirm, setConfirm] = useState<{ path: string; untracked: boolean } | null>(null)`.
- Add an async `runMutation(p: Promise<...>)` helper: `const r = await p; if (r.status === "ok") { onMutated() } else { setError("NonZero" in r.error ? r.error.NonZero.stderr : "Operation failed") }`. (After `onMutated` → refreshKey bump → this component remounts, so no local list mutation needed.)
- **Top toolbar** (above the `groups.map`): a `<div className="wc-toolbar">` with a **Stage all** button (`onClick={() => runMutation(commands.stageAll(repoPath))}`, disabled when `unstaged.length + untracked.length === 0`) and an **Unstage all** button (`commands.unstageAll(repoPath)`, disabled when `staged.length === 0`).
- **Per-file action buttons**: inside each file `<li>`, after the `detail-file` button, add a `<span className="wc-file-actions">` with buttons depending on the section (`g.key`). Each button's `onClick` MUST call `e.stopPropagation()` first so it doesn't trigger the row's `openFile`:
  - `Staged` → **Unstage** → `runMutation(commands.unstageFile(repoPath, f.path))`.
  - `Unstaged` → **Stage** → `commands.stageFile(repoPath, f.path)`; **Discard** → `setConfirm({ path: f.path, untracked: false })`.
  - `Untracked` → **Stage** → `commands.stageFile(repoPath, f.path)`; **Remove** → `setConfirm({ path: f.path, untracked: true })`.
- **Confirm modal** at the end of the returned JSX:
  ```tsx
  <ConfirmDialog
    open={confirm !== null}
    message={
      confirm === null
        ? ""
        : confirm.untracked
          ? `Delete untracked file "${confirm.path}"? This cannot be undone.`
          : `Discard changes to "${confirm.path}"? This cannot be undone.`
    }
    confirmLabel={confirm?.untracked ? "Delete" : "Discard"}
    onCancel={() => setConfirm(null)}
    onConfirm={() => {
      if (confirm !== null) {
        const c = confirm
        setConfirm(null)
        void runMutation(commands.discardFile(repoPath, c.path, c.untracked))
      }
    }}
  />
  ```
- NOTE: the empty-state and error-state early returns happen BEFORE the main JSX; make sure the `ConfirmDialog` is only reachable in the main return (a discard can only start from a rendered row, so that's fine). Keep the loop-safe pattern, keyboard nav, and `aliveRef`/genRef/reqRef intact.

- [ ] **Step 3: Style the toolbar + buttons**

In `src/detail/WorkingCopyDetail.css`: `.wc-toolbar` (flex row, small gap, bottom border) with compact buttons; `.wc-file-actions` (small buttons shown on the row, e.g. right-aligned — reuse a style close to `.detail-hide-tests`); a subtle danger style for Discard/Remove (the same `--danger-fg`/`--danger-bg`/`--danger-border` tokens used in ConfirmDialog). Buttons compact so rows don't grow much beyond `ROW_HEIGHT` feel. Theme tokens only. Optionally reveal `.wc-file-actions` on row hover/focus to reduce clutter (`:hover`/`:focus-within`), but ensure they're keyboard-focusable (don't `display:none` in a way that removes them from tab order when the row is focused).

- [ ] **Step 4: Wire Workspace**

In `src/workspace/Workspace.tsx`, pass `onMutated={refresh}` to `<WorkingCopyDetail .../>` (the `refresh` callback that bumps `refreshKey` already exists — confirm its name; it's the same one the ↻ button uses). Keep `key={refreshKey}`.

- [ ] **Step 5: Tests + mocks**

In `src/App.test.tsx`, add mocks: `stageFile`, `unstageFile`, `stageAll`, `unstageAll`, `discardFile` each `vi.fn().mockResolvedValue({ status: "ok", data: null })`.
Extend `src/detail/WorkingCopyDetail.test.tsx`:
- Clicking **Stage** on an unstaged file calls `commands.stageFile(repoPath, path)` and then `onMutated`.
- Clicking **Unstage** on a staged file calls `commands.unstageFile`.
- **Stage all** / **Unstage all** call `commands.stageAll` / `commands.unstageAll`.
- Clicking **Discard** opens the confirm dialog and does NOT call `discardFile` until **Discard** is confirmed; **Cancel** calls nothing and closes it. After confirm, `discardFile(repoPath, path, false)` is called (and `true` for an untracked **Remove**).
- An action button click does NOT also call `commands.workingFileDiff` (i.e. `stopPropagation` works — the row's diff-open didn't fire).
Provide `onMutated={vi.fn()}` in the test renders.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run build && cargo build --manifest-path src-tauri/Cargo.toml && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: staging-area actions (stage/unstage/discard) in WorkingCopyDetail"
```

---

## Self-Review

**Spec coverage:**
- stage / unstage file → Task 1 fns + Task 2 buttons ✓
- stage all / unstage all → Task 1 + Task 2 toolbar ✓
- discard (destructive, confirm) → Task 1 `discard_file` + Task 2 ConfirmDialog; `--worktree` (unstaged-only) semantics locked by Task 1's `discard_unstaged_keeps_staged` test ✓
- whole-file only; diff viewer read-only → no diff-editing added ✓
- refresh after mutation → `onMutated` → `refresh()` → refreshKey remount ✓

**Placeholder scan:** none.

**Type consistency:** git fns + command wrappers + generated bindings names align (`stageFile`/`unstageFile`/`stageAll`/`unstageAll`/`discardFile`); `discard_file`'s `untracked: bool` matches the frontend `discardFile(repoPath, path, untracked)` call and the `confirm.untracked` flag; `onMutated: () => void` added to `WorkingCopyDetail` props and passed `refresh` from Workspace.

**Known risks:**
1. **Destructive discard** — guarded by `ConfirmDialog`; `--worktree` keeps staged content (tested). Untracked uses `git clean -f` scoped to the exact path (frontend only offers Remove on untracked rows).
2. **Refresh via remount** — `onMutated` bumps `refreshKey`; `WorkingCopyDetail` (keyed on it) remounts and re-fetches. The diff panel may show a stale diff after a mutation (the file changed section); acceptable for v1.
3. **stopPropagation** — action buttons must stop propagation so they don't also open the diff; Task 2 requires it and Task 2's test asserts `workingFileDiff` isn't called on an action click.
4. **`git restore` on an unborn branch** — `--staged`/`--worktree` need a HEAD; on an unborn branch these can fail. Rare; the error surfaces inline. Not handled specially in v1.
5. **No optimistic UI** — the list always reflects the real post-command `git status` (via refetch), so a failed mutation leaves the view truthful (plus an inline error).
