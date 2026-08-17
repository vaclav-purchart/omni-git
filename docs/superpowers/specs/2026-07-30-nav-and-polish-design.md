# Keyboard Navigation & Polish — Design Spec

**Status:** Approved 2026-07-30. Four independent improvements: context-menu keyboard nav, entity-specific tag/remote menus, working-tree FS watch, and cross-panel Enter/Backspace focus flow.

## 1. Context-menu keyboard navigation
`ContextMenu` becomes keyboard-operable: on open, focus the first enabled item; **↑/↓** move focus between enabled items (skip separators + disabled/WIP, wrap at ends); **Enter/Space** activate the focused item (native `<button>` activation → its `onClick` + `onClose`); **Escape** closes (already). Separators render `role="separator"`.

## 2. Entity-specific branch/tag/remote menus
`buildBranchMenu(ref)` varies by `ref.kind`:
- **local:** current full set (Checkout, Merge … into current, Rebase, Fetch, Push …, Track, Diff Against Current ✓, Rename, Delete, **Copy Branch Name** ✓, Create PR).
- **tag:** Checkout `<tag>` (wip), Diff Against Current ✓, **Copy Tag Name** ✓, Delete `<tag>` (wip, danger). (Drop merge-into/push-tracked/track/create-PR — not meaningful for a tag.)
- **remote:** Checkout (wip), Diff Against Current ✓, Fetch `<remote>` (wip), **Copy Remote Branch Name** ✓, Delete (wip, danger), Create Pull Request… (wip). (Drop "Push to origin/self".)
Only the copy label + which items appear change; wired set stays Diff Against Current + Copy `<X>` Name.

## 3. Working-tree filesystem watch
Extend `watcher.rs` to ALSO watch the working tree (repo root), so plain working-tree edits (not just `.git` changes) emit `repoChanged` and auto-refresh the working view.
- **Noise control:** filter worktree events through a **gitignore-aware matcher** (the `ignore` crate) — ignored paths (`node_modules`, `target`, `dist`, …) and `.git`-internal paths (already covered by the git-dir watcher) do NOT trigger `repoChanged`. Emit only when a batch contains ≥1 non-ignored, non-`.git` worktree path.
- Reuses the existing debounce, `RepoChanged` event, and frontend focus-gating. `GIT_OPTIONAL_LOCKS=0` already prevents our own reads from self-triggering.
- Known limitation: `notify` still recursively watches ignored dirs (filtering is post-event); acceptable for v1 (huge ignored trees add watch overhead but are debounced). The gitignore matcher is built from the repo root `.gitignore` + `.git/info/exclude` (nested `.gitignore`s are a future refinement).

## 4. Cross-panel Enter / Backspace focus flow
```
Commit railway ──Enter──▶ File list ──Enter──▶ Diff view
      ◀────────Backspace───────◀────────Backspace────────
```
- Selection already cascades (selected commit → loads its files; selected file → shows its diff). **Enter** moves *focus* to the next panel; **Backspace** to the previous. From the file list, Enter focuses the diff (CodeMirror view) so ↑/↓ scroll it; Backspace from the diff returns to the file list; Backspace from the file list returns to the railway.
- Scoped to each panel's list container — **must not** hijack the railway search box, any text input, or CodeMirror text editing (the diff is read-only, so Backspace there is a safe no-op to repurpose).
- Workspace owns refs to the three panel roots + `focusCommits/focusFiles/focusDiff` helpers; each panel gets `onAdvance`/`onRetreat` callbacks it fires from its `onKeyDown`.
- Applies uniformly whether the selected railway row is a commit or the working-copy node (its "files" are the working files).

## Testing
- **ContextMenu:** open focuses first enabled item; ↑/↓ move focus skipping disabled/separators; Enter activates.
- **Menus:** tag ref → "Copy Tag Name" present, branch-only items absent; remote → "Copy Remote Branch Name".
- **Watcher:** unit-test the gitignore filter (a `node_modules/x` path is ignored; a `src/x` path is not) — the notify wiring itself isn't headlessly testable.
- **Cross-panel nav:** Enter on a focused railway (commit selected) calls `onAdvance`/focuses the file list; Enter on the file list focuses the diff; Backspace reverses; keys inside a text input are NOT hijacked.

## Out of scope
- Nested-`.gitignore` precision in the worktree filter (root + info/exclude for v1).
- Not-watching ignored dirs at the `notify` level (post-event filtering only).
- Wiring the still-WIP context-menu actions.
