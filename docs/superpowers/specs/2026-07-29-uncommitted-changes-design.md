# Uncommitted Changes (Working Copy) — Design Spec

**Status:** Approved 2026-07-29. Scope: **view-only** (no staging/commit/discard in this iteration).

## Goal

Let the user see uncommitted changes in the open repo, with staged / unstaged / untracked clearly distinguished, and view each file's diff in the normal diff viewer. The commit-history file view and the branch-compare (PR) view continue to work unchanged.

## Decisions (from brainstorming)

- **Scope:** view-only. Staging / unstaging / discard / commit are a later milestone (M4 write loop).
- **Placement:** a synthetic **"Uncommitted changes"** node pinned at the TOP of the commit railway (SourceTree-style), connected to HEAD. Shown only when there are changes.
- **Staged vs unstaged:** one files panel with grouped sections — **Staged**, **Unstaged**, **Untracked** — each with a header + count and per-file status badge.
- **Working-tree live refresh:** DEFERRED. The M2c watcher observes only `.git`, so staging / unstaging / commit / checkout auto-refresh the node (they write `.git/index` etc.), but a plain working-tree edit does not — the user refreshes via ↻ or by re-selecting the node. Watching the working tree (gitignore-aware) is a separate follow-up.

## Architecture

System git only, via `git::run`. Two new read commands; the diff reuses the existing `DiffView` (so the ignore-whitespace toggle and scroll-reset apply). The railway's existing lane engine (`computeGraph`, input `{hash, parents}`) is reused by injecting a synthetic pseudo-commit; no changes to the lane algorithm.

### Backend

**`working_status(repo_path) -> WorkingStatus`**
```
WorkingStatus { head: string | null, staged: FileChange[], unstaged: FileChange[], untracked: FileChange[] }
```
- Source: `git status --porcelain=v1 -z --untracked-files=all`.
- Each `-z` record is `XY<space>PATH` (`\0`-terminated); rename/copy records carry a second `\0`-terminated ORIG path — keep the new PATH for display.
- Classification per record:
  - `XY == "??"` → untracked (status `"?"`).
  - `XY == "!!"` → ignored; skip (we pass `-uall` not `--ignored`, so these won't appear, but skip defensively).
  - else: if `X` not in `{' '}` → staged entry with status from `X`; if `Y` not in `{' '}` → unstaged entry with status from `Y`. (A file staged AND further modified appears in both lists.)
- `head`: `git rev-parse HEAD` trimmed; `null` if it fails (unborn branch / empty repo).
- Reuse `FileChange { status, path }` and the existing name-parsing/dedupe helpers where practical.

**`working_file_diff(repo_path, path, section, ignore_whitespace) -> string`**
- `section: WorkingSection` — unit enum `{ Staged, Unstaged, Untracked }` (serializes as a string union in TS).
- staged → `git diff --cached --no-color [-w] -- <path>` (index vs HEAD)
- unstaged → `git diff --no-color [-w] -- <path>` (worktree vs index)
- untracked → `git diff --no-index --no-color [-w] -- /dev/null <path>`. `--no-index` exits 1 when the files differ (always true here), which the normal `run` treats as an error; use a `run_raw`-based helper that accepts exit codes 0 and 1 for this case. `-w` still honored.
- `[-w]` added only when `ignore_whitespace` is true (same convention as `file_diff`/`branch_file_diff`).

### Frontend

- **Sentinel:** `WORKING_HASH` (a clearly-synthetic constant, e.g. `"__WORKING_COPY__"`).
- **Railway injection:** the railway fetches `working_status` (on mount; it remounts on `refreshKey`, so M2c's `repoChanged` and the manual Refresh both re-trigger it). If `staged+unstaged+untracked > 0` and `head` is set, prepend a synthetic `CommitSummary` to the commit list: `hash = WORKING_HASH`, `parents = [head]`, `subject = "Uncommitted changes"`, empty author/refs, `timestamp_ms` = now. It flows through `computeGraph` like any commit → sits on HEAD's lane with a connector down to HEAD. All index-based logic (keyboard nav, Virtuoso, selectHash, search matches) operates uniformly on the augmented list; search/`commitMatch` never matches the sentinel (empty author, fixed subject — acceptable, it just won't be a search hit).
- **Row rendering:** `CommitRow` detects `hash === WORKING_HASH` and renders a distinct node: a special dot/icon, the label "Uncommitted changes", and counts ("3 staged · 2 unstaged · 1 untracked"); no hash/author/date columns.
- **Selection:** selecting the node calls the same `onSelect` + `onCommitClick` path a real row click uses, so it exits compare mode and resets the base (consistent with existing commit-click behavior). Workspace tracks `selected`; when `selected?.hash === WORKING_HASH` it renders `WorkingCopyDetail` in the bottom-left panel instead of `CommitDetail` (compare mode still takes precedence only while active; selecting the node exits it first).
- **`WorkingCopyDetail`:** fetches `working_status`, renders three grouped sections (Staged / Unstaged / Untracked) with headers + counts and per-file status badges. Clicking a file calls `working_file_diff(repo_path, path, section, ignoreWhitespace)` and pushes the result via the existing `onFileDiff` → `DiffView`. Loop-safe load pattern (genRef/reqRef, callback-in-ref) as in `CommitDetail`/`CompareDetail`. Arrow-key nav runs across all visible files (flattened order, section headers interleaved). Reuses the test/spec de-emphasis from `ChangedFilesList` where practical (either by generalizing it to a grouped mode or by composing per-section lists).
- **Empty state:** if there are no changes, no node is injected; if the node is selected and then all changes vanish (e.g. after an external commit), `WorkingCopyDetail` shows an empty message and the node disappears on the next refresh.

## Data Flow (view a staged file)

1. Railway mounts → `working_status` → prepends the node (counts in label).
2. User clicks the node → `onSelect(syntheticCommit)` + `onCommitClick` → Workspace exits compare, sets `selected`.
3. Workspace renders `WorkingCopyDetail` → it fetches `working_status` → shows sections.
4. User clicks a staged file → `working_file_diff(path, Staged, ignoreWhitespace)` → `onFileDiff` → `DiffView` renders the index-vs-HEAD patch.

## Error Handling

- `working_status` / `working_file_diff` return `Result`; on `NonZero`, surface the stderr in the detail panel's empty/error state (as `CompareDetail` already does).
- Empty repo / unborn HEAD: `head = null` → no node injected (nothing to compare against yet); `working_status` still lists untracked/staged files but the node needs a HEAD parent to inject, so with `head=null` we skip injection for v1 (documented limitation; rare).
- Untracked binary files: `git diff --no-index` prints "Binary files differ" — shown as-is in the diff panel.

## Testing

- **Rust:** unit-test the porcelain parser (`parse_working_status`) against a crafted `-z` string covering: staged-only (`M `), unstaged-only (` M`), staged+unstaged (`MM`), added (`A `), deleted (` D`), rename (`R ` with two paths), untracked (`??`). Integration-test `working_file_diff` section routing at the git level (build a temp repo with a staged + an unstaged + an untracked change; assert `--cached` vs plain vs `--no-index` produce the expected non-empty patches and that `-w` suppresses an indent-only change), mirroring `compare.rs`'s existing `git()` harness.
- **Frontend:** `WorkingCopyDetail` renders three sections with counts and calls `working_file_diff` with the right `section` per file; the railway injects the node only when there are changes and special-renders the sentinel; selecting the node routes to `WorkingCopyDetail` and exits compare.

## Out of Scope (this iteration)

- Staging / unstaging / discard / commit / any write op.
- Working-tree filesystem watching (deferred follow-up).
- Hunk/line-level views beyond the standard file diff.
- Submodule status detail.
