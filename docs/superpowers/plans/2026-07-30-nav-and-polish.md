# Keyboard Navigation & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four improvements — context-menu keyboard nav, entity-specific tag/remote menus, gitignore-aware working-tree FS watch, and cross-panel Enter/Backspace focus flow.

**Tech Stack:** Existing (React 19 / TS7 / Vitest / Biome; Rust `notify`/`notify-debouncer-full`). Adds the `ignore` crate (Rust) for gitignore filtering.

**Spec:** `docs/superpowers/specs/2026-07-30-nav-and-polish-design.md`.

## Global Constraints

- Frontend: TS7, Biome, theme-aware, generated bindings only, never `npm run tauri dev`. Backend: system git only (the FS watcher is a filesystem API, allowed).
- Additive — do not regress existing left-click, arrow-nav, search, or the diff viewer.
- Regenerate bindings headlessly if backend command signatures change (Task 3 changes none — `watch_repo` signature is unchanged).

---

### Task 1: Context-menu keyboard navigation

**Files:** Modify `src/ui/ContextMenu.tsx`, `src/ui/ContextMenu.test.tsx` (and `.css` if needed for focus outline).

- [ ] **Step 1:** In `ContextMenu.tsx`, give the menu container a ref. On mount (a `useEffect`/`useLayoutEffect` after the clamp), focus the FIRST enabled item button (`menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus()`). Add `onKeyDown` on the menu container: `ArrowDown`/`ArrowUp` → `preventDefault`, collect `Array.from(menuRef.current.querySelectorAll('button:not([disabled])'))`, find the index of `document.activeElement`, focus the next/previous (wrap around). `Enter`/`Space` need no special handling — a focused `<button>` activates natively (firing its `onClick` → `item.onClick` + `onClose`). Keep the existing Escape/outside-close. Render separators with `role="separator"`.

- [ ] **Step 2:** Tests: opening focuses the first enabled item; ArrowDown moves focus to the next enabled item and SKIPS a disabled/WIP item and a separator; ArrowUp wraps; pressing Enter on a focused enabled item fires its onClick + onClose (fireEvent.keyDown or click). Keep existing tests green.

- [ ] **Step 3:** Verify `npx vitest run && npm run build && npm run lint`; commit `feat: keyboard navigation in ContextMenu (focus + arrow keys)`.

---

### Task 2: Entity-specific branch / tag / remote menus

**Files:** Modify `src/sidebar/Sidebar.tsx`, `src/sidebar/Sidebar.test.tsx`.

- [ ] **Step 1:** In `Sidebar.tsx`, make `buildBranchMenu(ref)` (around line 48) switch on `ref.kind`:
  - `"local"`: the current full item list (unchanged).
  - `"tag"`: `[ { label: \`Checkout ${ref.name}\`, wip }, sep, { label: "Diff Against Current", onClick: () => onDiffRef?.(ref) }, sep, { label: "Copy Tag Name to Clipboard", onClick: () => navigator.clipboard?.writeText(ref.name).catch(()=>{}) }, sep, { label: \`Delete ${ref.name}\`, wip, danger } ]`.
  - `"remote"`: `[ { label: "Checkout", wip }, { label: \`Fetch ${ref.name}\`, wip }, sep, { label: "Diff Against Current", onClick: () => onDiffRef?.(ref) }, sep, { label: "Copy Remote Branch Name to Clipboard", onClick: () => navigator.clipboard?.writeText(ref.name).catch(()=>{}) }, sep, { label: \`Delete ${ref.name}\`, wip, danger }, { label: "Create Pull Request…", wip } ]`.
  Keep the wired actions (Diff Against Current, Copy) working for all three; only the item set + copy label differ. (Extract shared item objects if helpful, but keep it readable.)

- [ ] **Step 2:** Tests: right-click a TAG ref → menu contains "Copy Tag Name to Clipboard" and does NOT contain "Merge" / "Push to origin" / "Track Remote"; right-click a REMOTE ref → "Copy Remote Branch Name to Clipboard" present. Reuse the existing Sidebar test setup (it already renders a tag/remote per `useRepoRefs` mock — add tag/remote data if needed).

- [ ] **Step 3:** Verify; commit `feat: entity-specific tag/remote context menus`.

---

### Task 3: Gitignore-aware working-tree FS watch

**Files:** Modify `src-tauri/Cargo.toml` (add `ignore`), `src-tauri/src/watcher.rs`.

- [ ] **Step 1:** Add dep `ignore = "0.4"` to `src-tauri/Cargo.toml`.

- [ ] **Step 2:** In `src-tauri/src/watcher.rs` `watch()`: in addition to watching the resolved `git_dir` (as now), also watch the working-tree root (`repo_path`) recursively, and filter worktree events through a gitignore matcher so noise (node_modules/target/dist/…) doesn't emit `RepoChanged`.
  - Build a `ignore::gitignore::Gitignore` once, before the closure: `let mut b = ignore::gitignore::GitignoreBuilder::new(repo_path); b.add(Path::new(repo_path).join(".gitignore")); b.add(Path::new(&git_dir).join("info/exclude")); let gi = b.build().ok();` (tolerate build failure → `None` = don't filter, or treat as "nothing ignored").
  - Capture `git_dir` (PathBuf) and `repo_path` (PathBuf) + `gi` into the debouncer closure (move clones).
  - In the closure, replace the blanket `!events.is_empty()` with a filter: emit `RepoChanged` iff ANY event path `p` is "relevant":
    - relevant if `p` starts_with `git_dir` (repo metadata — always accept), OR
    - `p` starts_with `repo_root` AND does NOT start_with `git_dir` (avoid double-counting `.git` for normal repos) AND is NOT gitignored (`gi.as_ref().map_or(true, |g| !g.matched(&p, p.is_dir()).is_ignore())`).
    Iterate all events; if any is relevant, `RepoChanged {}.emit(...)`.
  - Watch BOTH roots on the debouncer + cache: `deb.watcher().watch(&git_dir, Recursive)`, `deb.watcher().watch(repo_root, Recursive)`, and `deb.cache().add_root(...)` for each. (If `git_dir` is under `repo_root` — normal repo — watching both is redundant but harmless; the filter dedupes emission. Handle a `watch` error on either root gracefully — if the worktree watch fails, still keep the git-dir watch.)
  - Extract the relevance predicate into a small pure fn `fn is_relevant(path, git_dir, repo_root, gi) -> bool` so it's unit-testable WITHOUT notify.

- [ ] **Step 3:** Unit-test `is_relevant` (no AppHandle/notify needed): a path under `<repo>/.git/…` → relevant; `<repo>/src/main.rs` (not ignored) → relevant; `<repo>/node_modules/x` (ignored via a Gitignore built with a `node_modules/` rule) → NOT relevant; `<repo>/target/debug/x` (ignored) → NOT relevant. Build the `Gitignore` in the test via `GitignoreBuilder` with explicit rules (don't rely on a real repo). Follow the existing test conventions in `watcher.rs`/`compare.rs`.

- [ ] **Step 4:** Verify `cargo test --manifest-path src-tauri/Cargo.toml && cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`. NOTE: the notify runtime behavior isn't headlessly testable — the unit test covers the filter; the wiring is inspection + the manual smoke test. Commit `feat: watch the working tree (gitignore-filtered) so plain edits auto-refresh`.

---

### Task 4: Cross-panel Enter / Backspace focus flow

**Files:** Modify `src/workspace/Workspace.tsx`, `src/railway/CommitRailway.tsx`, `src/detail/FileList.tsx`, `src/detail/CommitDetail.tsx`, `src/detail/CompareDetail.tsx`, `src/detail/WorkingCopyDetail.tsx`, `src/diff/DiffView.tsx`.

**Contract:** Workspace owns three DOM refs (`railwayRootRef`, `filesRootRef`, `diffRootRef`) + helpers `focusCommits/focusFiles/focusDiff = () => ref.current?.focus()`. Panels attach the ref to their focusable root and fire `onAdvance`/`onRetreat` from their keydown.

- [ ] **Step 1: Railway.** `CommitRailway` gains `rootRef?: React.RefObject<HTMLDivElement>` (attach to the `.railway` div, alongside the existing tabIndex=0/onKeyDown) and `onAdvance?: () => void`. In its `onKeyDown`, add: `if (e.key === "Enter" && !isFromInput(e)) { e.preventDefault(); onAdvance?.() }` — where `isFromInput` checks `e.target` isn't an `<input>`/`<textarea>` (mirror the existing guard the railway uses to ignore search-box keys). Do not disturb the search/Arrow handling.

- [ ] **Step 2: FileList.** Add `rootRef?: React.RefObject<HTMLDivElement>` (attach to the `.detail` listbox), `onAdvance?`, `onRetreat?`. In its `onKeyDown` (currently handles Arrow keys): `Enter` → `e.preventDefault(); onAdvance?.()`; `Backspace` → `e.preventDefault(); onRetreat?.()`. Thread `rootRef`/`onAdvance`/`onRetreat` as pass-through props from `CommitDetail`/`CompareDetail`/`WorkingCopyDetail` (each adds these three optional props and forwards them to `<FileList>`; they don't build them).

- [ ] **Step 3: DiffView.** Add `rootRef?: React.RefObject<HTMLDivElement>` + `onRetreat?`. Attach `rootRef` + `tabIndex={0}` + an `onKeyDown` to the `.diff-view` container: `Backspace` → `e.preventDefault(); onRetreat?.()`; `ArrowDown`/`ArrowUp` → `preventDefault` and scroll the CodeMirror scroller (`cmRef.current?.view?.scrollDOM.scrollBy({ top: ±40 })`) so the focused diff is arrow-scrollable. Keep the existing scroll-reset effect + toggle.

- [ ] **Step 4: Workspace wiring.** Add the three refs. Pass:
  - `<CommitRailway rootRef={railwayRootRef} onAdvance={() => filesRootRef.current?.focus()} ... />`
  - to the detail components: `filesRootRef={filesRootRef}`, `onAdvanceFiles={() => diffRootRef.current?.focus()}`, `onRetreatFiles={() => railwayRootRef.current?.focus()}` (they forward as `rootRef`/`onAdvance`/`onRetreat` to FileList).
  - `<DiffView rootRef={diffRootRef} onRetreat={() => filesRootRef.current?.focus()} ... />`.
  Focusing a `tabIndex=0` div works (they're already focusable). Verify the railway root already has tabIndex=0 (it does) so `focus()` works.

- [ ] **Step 5: Tests.** (a) `CommitRailway`: firing `keyDown{Enter}` on the `.railway` container (with a commit selected, target not an input) calls the `onAdvance` prop; an Enter dispatched from within a mocked search `<input>` does NOT. (b) `FileList`: `keyDown{Enter}` calls `onAdvance`, `keyDown{Backspace}` calls `onRetreat`. (c) `DiffView`: `keyDown{Backspace}` on the container calls `onRetreat`. Keep existing tests green (the new props are optional).

- [ ] **Step 6:** Verify `npx vitest run && npm run build && npm run lint`; commit `feat: cross-panel Enter/Backspace focus flow (commits → files → diff)`.

---

## Self-Review

**Spec coverage:** menu kbd nav (T1) ✓; entity menus (T2) ✓; worktree watch + gitignore filter (T3) ✓; cross-panel focus flow (T4) ✓.

**Placeholder scan:** none.

**Type consistency:** `MenuItem` unchanged (T1/T2); watcher `is_relevant(path, git_dir, repo_root, gi)` pure + tested (T3); `rootRef`/`onAdvance`/`onRetreat` optional props threaded Workspace → CommitRailway / (detail → FileList) / DiffView (T4).

**Known risks:**
1. **Worktree watch resource use** — `notify` recursively watches ignored dirs (filter is post-event); acceptable v1, documented. If it bites, a future refinement skips ignored dirs at watch time.
2. **git_dir under repo_root double-watch** — harmless; the relevance filter dedupes `.git` emission (git_dir branch accepts, worktree branch excludes `git_dir` paths).
3. **Backspace hijack** — only handled on panel LIST containers + the read-only diff (safe no-op); inputs/search/CodeMirror-editing untouched (the diff is read-only). T4 must not add Backspace handling to any text input.
4. **Focus targets** — all three panel roots are `tabIndex=0` divs; `.focus()` works. DiffView's container gets `tabIndex=0` (new).
5. **Enter in railway** — guarded to ignore events from the search input (reuse the railway's existing input guard).
