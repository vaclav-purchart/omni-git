# Staging Area (Whole-File Write Ops) — Design Spec

**Status:** Approved 2026-07-29. Builds on the merged uncommitted-changes view. Scope: whole-file **stage / unstage / stage-all / unstage-all / discard**. NO commit/push/pull, NO hunk/line staging (later milestones).

## Goal

Turn the read-only working-copy view into an actual staging area: move files between Staged / Unstaged / Untracked, and discard changes — all at whole-file granularity, from the existing `WorkingCopyDetail` panel.

## Decisions (from brainstorming)

- Operations: **stage file, unstage file, stage all, unstage all, discard file** (destructive).
- Granularity: **whole-file only** (diff viewer stays read-only).
- **Discard scope:** on an Unstaged row, discard only the unstaged worktree edits (`git restore --worktree`), keeping any staged version. Untracked → delete the file. Discard is per-file only (no "discard all").
- Destructive discard requires an **in-app confirm modal** (Cancel / Discard) — not a typed confirmation (that's too heavy per-file), but an explicit two-step.

## Architecture

System git only, via `git::run`. Four/five new mutation commands returning `Result<(), GitError>`. The frontend extends `WorkingCopyDetail` with action buttons + a confirm modal, and after any successful mutation calls an `onMutated()` callback → Workspace `refresh()` (bumps `refreshKey`, already remounting the working detail + railway pinned row → fresh `working_status`). This is deterministic and does not depend on the M2c FS-watch (which wouldn't observe worktree-only ops like discard).

### Backend (new commands in `commands::repo_read` or a new `commands::repo_write`)

All take `(app, repo_path: String, ...)` and return `Result<(), GitError>`; each runs one git command via `git::run::run` (which logs to the console + ring buffer). Git-module fns live in `src-tauri/src/git/working.rs` (or a sibling `stage.rs`).

- `stage_file(repo, path)` → `git add -- <path>` (stages modifications, additions, and deletions for that path).
- `unstage_file(repo, path)` → `git restore --staged -- <path>`.
- `stage_all(repo)` → `git add -A` (stages everything: tracked changes, deletions, untracked).
- `unstage_all(repo)` → `git restore --staged .`.
- `discard_file(repo, path, untracked: bool)`:
  - `untracked == true` → `git clean -f -- <path>` (removes the untracked file).
  - `untracked == false` → `git restore --worktree -- <path>` (discards unstaged worktree edits back to the index; keeps staged content; a file with nothing staged reverts to HEAD).

Edge cases:
- Unborn branch (no HEAD): `git restore --staged` may fail; acceptable/rare — surface the error. Staging still works.
- `git clean` needs the path to actually be untracked; the frontend only calls `discard_file(untracked=true)` from an Untracked row, so this holds.

### Frontend (`WorkingCopyDetail` + a confirm modal + Workspace)

- New prop `onMutated: () => void` (Workspace passes `refresh`). Called after every successful mutation.
- **Top toolbar** in `WorkingCopyDetail`: **Stage all** (`stage_all`) and **Unstage all** (`unstage_all`) buttons; disabled when there's nothing to act on.
- **Per-file actions** (small buttons on each row; `onClick` calls `e.stopPropagation()` so the row's diff-open doesn't also fire):
  - Staged row → **Unstage** (`unstage_file`).
  - Unstaged row → **Stage** (`stage_file`) + **Discard** (`discard_file(untracked=false)`, confirmed).
  - Untracked row → **Stage** (`stage_file`) + **Remove** (`discard_file(untracked=true)`, confirmed).
- **Confirm modal:** a small theme-aware overlay shown when a discard/remove is requested. Copy: tracked → "Discard changes to `<path>`? This cannot be undone."; untracked → "Delete untracked file `<path>`? This cannot be undone." Buttons: Cancel / Discard (Remove). State: `confirm: { path, untracked } | null`.
- **After a mutation resolves ok:** call `onMutated()` (→ `refresh()` → refreshKey bump → the detail + pinned row remount and re-fetch `working_status`). A failed command surfaces an inline error (reuse the existing error state). Because the detail remounts, the currently-shown diff may be stale after a mutation — acceptable for v1 (the file often changes section); optionally the mutation could clear the diff, but not required.
- Keyboard file-nav (ArrowUp/Down) unchanged; action buttons are reachable via Tab and don't hijack the listbox nav.

## Data Flow (stage a file)

1. User clicks **Stage** on an unstaged row → `e.stopPropagation()` → `await commands.stageFile(repo, path)`.
2. On ok → `onMutated()` → Workspace `refresh()` → `refreshKey++`.
3. `WorkingCopyDetail` (keyed on `refreshKey`) + the railway pinned row remount → re-fetch `working_status` → the file now appears under Staged; counts update.

## Error Handling

- Mutation `Result` errors surface inline (reuse `WorkingCopyDetail`'s error state, showing the `NonZero` stderr). The confirm modal closes on action regardless; an error is shown after.
- No optimistic UI — the list reflects the real post-command `git status`.

## Testing

- **Rust:** git-level integration tests (mirror `compare.rs`'s temp-repo `git()` harness) asserting each command's EFFECT via `git status --porcelain`:
  - stage: a modified/untracked file moves to staged (X set).
  - unstage: a staged file moves back (X cleared, Y set / untracked).
  - stage_all / unstage_all: all changes staged / all cleared.
  - discard tracked-unstaged: worktree reverts, a separately-staged hunk is preserved (verify `--worktree` keeps the staged index entry).
  - discard untracked: the file is gone from disk and from `status`.
- **Frontend:** `WorkingCopyDetail` — clicking Stage calls `commands.stageFile(repo, path)` then `onMutated`; Unstage/Stage-all/Unstage-all call the right commands; Discard opens the confirm modal and only calls `discardFile(..., untracked)` after confirming (Cancel calls nothing); button clicks don't trigger the row's diff-open.

## Out of Scope

- Commit / amend / push / pull / fetch (later write-loop milestone).
- Hunk/line-level staging (later).
- Discard-all / clean-all bulk destructive ops.
- Undo of a discard (git provides none for uncommitted worktree changes; the confirm modal is the guard).
