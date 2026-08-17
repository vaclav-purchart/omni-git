# Right-Click Context Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click context menus on commit rows, sidebar branches, and file-panel rows (entity-aware). Implemented actions are wired; unbuilt ones show as disabled WIP items.

**Architecture:** A reusable portal `ContextMenu` component. Each consumer keeps local menu state + an `onContextMenu` handler that builds a `MenuItem[]` and opens the menu at the cursor. Wired actions: clipboard copies, working-copy stage/unstage/discard/remove (reused), branch "Diff Against Current" (reuses compare). Everything else = WIP-disabled.

**Tech Stack:** Existing (React 19 / TS7 / Vitest / Biome, Phosphor icons). No new deps.

**Spec:** `docs/superpowers/specs/2026-07-30-context-menus-design.md`.

## Global Constraints

- Frontend only; TS7; Biome verbatim; theme-aware (tokens only). Phosphor icons via the app-wide `IconContext` (no per-icon props). WIP icon = `Wrench`.
- Clipboard via `navigator.clipboard.writeText` (guard in try/catch; it's best-effort).
- The context menu is ADDITIVE — do not change existing left-click / keyboard behavior of rows/branches.
- `MenuItem` type + `ContextMenu` are shared (Task 1); Tasks 2–4 consume them.
- `localStorage.clear()` in `beforeEach` where a test touches persisted state (unrelated, but existing convention).

## File Structure

- `src/ui/ContextMenu.tsx` (new) + `.css` (new) + `.test.tsx` (new).
- `src/railway/CommitRow.tsx` + `src/railway/CommitRailway.tsx` (modify) — commit menu.
- `src/detail/FileList.tsx` (modify) — `onRowContextMenu` prop.
- `src/detail/CommitDetail.tsx`, `src/detail/CompareDetail.tsx`, `src/detail/WorkingCopyDetail.tsx` (modify) — file menus.
- `src/sidebar/Sidebar.tsx` (modify) + `src/workspace/Workspace.tsx` (modify) — branch menu + Diff-Against-Current callback.

---

### Task 1: `ContextMenu` component

**Files:** Create `src/ui/ContextMenu.tsx`, `src/ui/ContextMenu.css`, `src/ui/ContextMenu.test.tsx`

**Interfaces (produces):**
```ts
export type MenuItem =
  | { type: "separator" }
  | {
      type: "item"
      label: string
      icon?: React.ReactNode
      onClick?: () => void
      disabled?: boolean
      wip?: boolean
      danger?: boolean
    }
export type ContextMenuProps = {
  items: MenuItem[]
  position: { x: number; y: number }
  onClose: () => void
}
export function ContextMenu(props: ContextMenuProps): JSX.Element
```

- [ ] **Step 1: Component**

Create `src/ui/ContextMenu.tsx` — render via `createPortal` to `document.body`. A `<div className="context-menu" role="menu">` positioned `fixed` at `position` (clamped to the viewport: after mount, measure with a ref and shift left/up if it would overflow `window.innerWidth/innerHeight`, via a `useLayoutEffect` adjusting a local `pos` state seeded from `position`). Render items: `separator` → `<div className="context-menu-sep" />`; `item` → a `<button role="menuitem" className="context-menu-item ..." disabled={disabled || wip}>` with optional leading `icon`, the `label`, and — when `wip` — a trailing `<Wrench />` + `title="Not yet implemented"`; `danger` adds `is-danger`. An enabled item's `onClick` fires then calls `onClose()`. Close on: Escape (keydown), outside `mousedown`, and `window` `blur`/`scroll`/`resize` (a `useEffect` adding/removing listeners; call `onClose`). WIP/disabled items are not clickable (the `disabled` attr handles it).

- [ ] **Step 2: CSS**

`src/ui/ContextMenu.css`: `.context-menu` fixed, `z-index` above panels, `var(--surface)` bg, `var(--border)` 1px, `--shadow-md`, small radius, min-width ~200px, `padding: 4px 0`. `.context-menu-item` full-width flex row (`gap: 0.5em`, `padding: 4px 12px`, `var(--fg)`, hover `var(--surface-hover)`); `:disabled` → `var(--muted)`, `cursor: default`, no hover. `.context-menu-item.is-danger` → `var(--danger-fg)`. `.context-menu-wip` (the trailing wrench) → `margin-left: auto; color: var(--muted)`. `.context-menu-sep` → 1px `var(--border)`, small vertical margin. Tokens only.

- [ ] **Step 3: Tests**

`src/ui/ContextMenu.test.tsx`: renders items + separators; clicking an enabled item fires its `onClick` and calls `onClose`; a `disabled`/`wip` item is a disabled button and does NOT fire `onClick`; Escape calls `onClose`; a `mousedown` outside the menu calls `onClose` (append the menu, dispatch a mousedown on `document.body`). (Viewport clamping is layout math — a light assertion that it renders at/near the given position is enough; jsdom has no layout.)

Run: `npx vitest run src/ui/ContextMenu.test.tsx && npm run build && npm run lint` → green.

- [ ] **Step 4: Commit** `feat: reusable ContextMenu (portal, WIP items, viewport-clamped)`

---

### Task 2: Commit-row context menu

**Files:** Modify `src/railway/CommitRow.tsx`, `src/railway/CommitRailway.tsx`

**Interfaces:** `CommitRow` gains `onContextMenu?: (commit: CommitSummary, e: React.MouseEvent) => void` → attach to the row `<button onContextMenu={(e) => onContextMenu?.(commit, e)}>`. `CommitRailway` owns the menu state + builder.

- [ ] **Step 1: Wire CommitRow**

In `src/railway/CommitRow.tsx`, add the optional `onContextMenu` prop and set `onContextMenu={(e) => onContextMenu?.(commit, e)}` on the row button (do NOT `preventDefault` in CommitRow — the handler in the railway does). Leave `onClick` unchanged.

- [ ] **Step 2: Menu in CommitRailway**

In `src/railway/CommitRailway.tsx`: add `const [menu, setMenu] = useState<{ pos: { x: number; y: number }; items: MenuItem[] } | null>(null)`. Pass `onContextMenu={(commit, e) => { e.preventDefault(); setMenu({ pos: { x: e.clientX, y: e.clientY }, items: buildCommitMenu(commit) }) }}` to each `CommitRow` (the sentinel WorkingRow does NOT get a commit menu — skip it). `buildCommitMenu(commit)` returns the items from the spec: mostly `wip: true`, with two wired:
- `{ type: "item", label: "Copy", icon: <Copy/>, onClick: () => navigator.clipboard.writeText(commit.hash.slice(0,7)).catch(() => {}) }`
- `{ type: "item", label: "Copy SHA-1 to Clipboard", onClick: () => navigator.clipboard.writeText(commit.hash).catch(() => {}) }`
Include the WIP items (Checkout…, Merge…, Rebase…, Tag…, Branch…, Reset to this commit, Reverse commit…, Cherry Pick, Archive…, Create Patch…, Custom Actions ▸) each `{ type: "item", label, wip: true }`, with `{ type: "separator" }` between groups (per spec). Render `{menu && <ContextMenu items={menu.items} position={menu.pos} onClose={() => setMenu(null)} />}`. Use whatever Phosphor icons fit (or omit icons on WIP items — a leading icon is optional).

- [ ] **Step 3: Verify + test**

Add a test (in a new or existing railway test): right-clicking a commit row opens a menu containing "Copy SHA-1 to Clipboard"; clicking it calls `navigator.clipboard.writeText` with the full hash (mock `navigator.clipboard`). WIP items are disabled.
Run: `npx vitest run && npm run build && npm run lint` → green.

- [ ] **Step 4: Commit** `feat: commit-row context menu (copy SHA wired, rest WIP)`

---

### Task 3: File-row context menus (entity-aware)

**Files:** Modify `src/detail/FileList.tsx`, `src/detail/CommitDetail.tsx`, `src/detail/CompareDetail.tsx`, `src/detail/WorkingCopyDetail.tsx`

**Interfaces:** `FileList` gains `onRowContextMenu?: (file: FileChange, section: string) => void` and calls it from each row's `onContextMenu` (`e` preventDefault + clientX/Y captured by the CONSUMER — so pass the event too): make it `onRowContextMenu?: (file: FileChange, section: string, e: React.MouseEvent) => void`.

- [ ] **Step 1: FileList plumbing**

In `src/detail/FileList.tsx`, add the optional `onRowContextMenu` prop; on each row `<button ... onContextMenu={(e) => onRowContextMenu?.(f, s.key, e)}>`. Left-click `onClick` unchanged.

- [ ] **Step 2: CommitDetail + CompareDetail menus**

In `CommitDetail.tsx`: add `const [menu, setMenu] = useState<{pos,items}|null>(null)`; pass `onRowContextMenu={(f, _section, e) => { e.preventDefault(); setMenu({ pos: {x:e.clientX,y:e.clientY}, items: buildFileMenu(f.path) }) }}` to `<FileList>`; render the `<ContextMenu>`. `buildFileMenu(path)` = `Copy Path To Clipboard` (wired: `navigator.clipboard.writeText(path)`) + WIP items (Log Selected…, Annotate Selected…, Reset to Commit…, Open Current Version, Open Selected Version, Show In Finder, Quick Look, External Diff). In `CompareDetail.tsx`: same pattern, builder = `Copy Path` (wired) + WIP (Open at head, Open at base, Show In Finder, External Diff).

- [ ] **Step 3: WorkingCopyDetail section-aware menu**

In `WorkingCopyDetail.tsx`: add the menu state; pass `onRowContextMenu={(f, section, e) => { e.preventDefault(); setMenu({ pos, items: buildWorkingMenu(f, section as WorkingSection) }) }}`. `buildWorkingMenu(f, section)` reuses the existing handlers:
- `Staged`: `{ label: "Unstage", onClick: () => runMutation(commands.unstageFile(repoPath, f.path)) }`, `Copy Path` (wired), then WIP (Show In Finder, Open).
- `Unstaged`: `Stage` (`runMutation(commands.stageFile(...))`), `Discard…` (`danger`, `onClick: () => setConfirm({ path: f.path, untracked: false })`), `Copy Path`, WIP (Show In Finder, Open).
- `Untracked`: `Stage`, `Remove…` (`danger`, `setConfirm({ path: f.path, untracked: true })`), `Copy Path`, WIP (Add to .gitignore, Show In Finder).
Render `{menu && <ContextMenu .../>}` alongside the existing `<ConfirmDialog>`. (The ConfirmDialog + runMutation already exist — reuse; a menu "Discard" simply opens the same confirm flow.)

- [ ] **Step 4: Verify + tests**

Add tests: right-click a committed file → menu has "Copy Path To Clipboard" (wired) + WIP items; right-click an Unstaged working file → menu has Stage/Discard/Copy Path (Stage calls `commands.stageFile`; Discard opens the confirm dialog); mock `navigator.clipboard`.
Run: `npx vitest run && npm run build && npm run lint` → green.

- [ ] **Step 5: Commit** `feat: entity-aware file-row context menus (working-copy actions wired)`

---

### Task 4: Sidebar branch context menu + Diff Against Current

**Files:** Modify `src/sidebar/Sidebar.tsx`, `src/workspace/Workspace.tsx`

**Interfaces:** `Sidebar` gains `onDiffRef?: (ref: { name: string; tip: string; kind: "local"|"remote"|"tag" }) => void`. Workspace passes a handler that enters compare with that branch as head.

- [ ] **Step 1: Branch menu in Sidebar**

In `src/sidebar/Sidebar.tsx`: add `const [menu, setMenu] = useState<{pos,items}|null>(null)`. Attach `onContextMenu` to each branch button/row (`refButton` + the local-branch button): `onContextMenu={(e) => { e.preventDefault(); setMenu({ pos: {x:e.clientX,y:e.clientY}, items: buildBranchMenu({name, tip, kind}) }) }}`. `buildBranchMenu(ref)` per spec — wired: `Diff Against Current` (`onClick: () => onDiffRef?.(ref)`), `Copy Branch Name to Clipboard` (`navigator.clipboard.writeText(ref.name)`); WIP: Checkout, Merge … into current, Rebase current onto …, Fetch …, Push to origin/…, Push to ▸, Track Remote Branch ▸, Rename…, Delete … (danger), Create Pull Request…. Insert separators per spec. Render `{menu && <ContextMenu .../>}`. (Tags/remotes may show a reduced set — for v1 the same builder is fine; "Diff Against Current" + "Copy … Name" still make sense; keep it simple.)

- [ ] **Step 2: Workspace wiring for Diff Against Current**

In `src/workspace/Workspace.tsx`, pass `onDiffRef` to `<Sidebar>`: it should enter compare with the picked branch as head vs the current branch's base — mirror what the existing "Compare with base" toggle does, but seeded from this ref. Concretely: `onDiffRef={(ref) => { setActiveBranch(ref.kind === "tag" ? null : ref.name); setSelectHash(ref.tip); setCompareMode(true); setCompareBase(null) }}` — reuse the existing compare state (`compareHead = activeBranch ?? currentBranch`; base auto-detected as today when `compareBase` is null). Confirm against how "Compare with base" currently sets state and match it (so the compare view opens for that branch). If base auto-detection needs a value, leave `compareBase` null so the existing fork-base default kicks in.

- [ ] **Step 3: Verify + tests**

Add a test: right-click a local branch → menu has "Copy Branch Name to Clipboard" (calls clipboard with the name) and "Diff Against Current" (calls `onDiffRef` with the ref); WIP items disabled. Mock clipboard.
Run: `npx vitest run && npm run build && npm run lint` → green.

- [ ] **Step 4: Commit** `feat: sidebar branch context menu (copy name + diff-against-current wired)`

---

## Self-Review

**Spec coverage:** reusable ContextMenu (T1) ✓; commit menu (T2) ✓; entity-aware file menus incl working-copy wired actions (T3) ✓; branch menu + Diff Against Current (T4) ✓; WIP = disabled + wrench (T1) ✓; clipboard copies wired ✓.

**Placeholder scan:** none.

**Type consistency:** `MenuItem`/`ContextMenu` from `src/ui/ContextMenu` used by all consumers; `onRowContextMenu(file, section, e)` on FileList consumed by the 3 detail components; `onContextMenu(commit, e)` on CommitRow; `onDiffRef(ref)` on Sidebar wired from Workspace; `section` cast to `WorkingSection` in WorkingCopyDetail's builder.

**Known risks:**
1. **`navigator.clipboard`** may be unavailable/blocked in some webview configs — guarded with `.catch(()=>{})`; a Rust clipboard command is the follow-up if needed.
2. **Viewport clamping** for the menu near the bottom/right edge — handled by a `useLayoutEffect` measuring + shifting; jsdom can't verify layout, so it's inspection + the manual smoke test.
3. **Right-click must `preventDefault`** to suppress the native menu — done in each consumer's handler (not in the leaf row components).
4. **Diff Against Current** relies on the existing compare state machine; Task 4 Step 2 must mirror the current "Compare with base" state transitions exactly (read them first) so the compare view actually opens.
5. **WorkingRow (sentinel)** must NOT get the commit menu — Task 2 skips it.
