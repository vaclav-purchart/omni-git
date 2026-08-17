# Right-Click Context Menus — Design Spec

**Status:** Approved 2026-07-30. SourceTree-inspired context menus on commit rows, sidebar branches, and file-panel rows. Unbuilt actions appear as disabled "work-in-progress" items so the menus scaffold future functionality.

## Goal

Right-clicking a commit, a branch, or a file row opens a context menu of relevant actions. Actions that are implemented are wired; actions that aren't yet appear **disabled with a WIP (wrench) icon**. File menus are **entity-aware** — a file's actions depend on its kind (committed / PR / staged / unstaged / untracked).

## Reusable component

`src/ui/ContextMenu.tsx` (+ `.css`) — a portal-rendered popup positioned at the cursor:
- Props: `{ items: MenuItem[]; position: { x: number; y: number }; onClose: () => void }`.
- `type MenuItem = { type: "separator" } | { type: "item"; label: string; icon?: ReactNode; onClick?: () => void; disabled?: boolean; wip?: boolean; danger?: boolean }`.
- **WIP items:** rendered disabled + muted with a trailing `Wrench` icon and `title="Not yet implemented"`. `danger` items use `--danger-*`.
- Closes on: Escape, outside-click (mousedown outside), selecting an enabled item, and window blur/scroll. Repositions to stay within the viewport (clamp x/y so it doesn't overflow the window edges).
- Theme-aware (tokens only), like `ConfirmDialog`. `role="menu"` / items `role="menuitem"`; Escape + basic arrow-key nav optional (Escape required).

Each consumer holds `const [menu, setMenu] = useState<{ pos: {x,y}; items: MenuItem[] } | null>(null)`, an `onContextMenu` handler (`e.preventDefault()`; build items; `setMenu({ pos: { x: e.clientX, y: e.clientY }, items })`), and renders `{menu && <ContextMenu {...} onClose={() => setMenu(null)} />}`.

## Wired vs WIP

- **Clipboard** via `navigator.clipboard.writeText` (works in the Tauri webview under the click gesture). Wired: Copy SHA-1, Copy Path, Copy Branch Name.
- Working-copy file actions reuse existing commands: **Stage / Unstage / Discard / Remove** (via `WorkingCopyDetail`'s `runMutation`/`setConfirm`).
- **Diff Against Current** (branch) reuses the existing compare view (one callback to Workspace).
- Everything else → **WIP-disabled** (submenus `Push to ▸` / `Track Remote ▸` / `Custom Actions ▸` render as flat WIP items, no nesting yet).

## Menus

### Commit row (railway)
Checkout… (wip), Push revision… (wip), Merge… (wip), Rebase… (wip), Rebase children interactively… (wip) — sep — Tag… (wip), Sign… (wip), Bookmark… (wip), Archive… (wip), Branch… (wip) — sep — Reset to this commit (wip), Reverse commit… (wip), Create Patch… (wip), Cherry Pick (wip) — sep — **Copy** (short hash ✓), **Copy SHA-1 to Clipboard** (✓) — sep — Custom Actions ▸ (wip).

### Sidebar branch
Checkout `<branch>` (wip), Merge `<branch>` into `<current>` (wip), Rebase current onto `<branch>` (wip) — sep — Fetch `<branch>` (wip) — sep — Push to origin/`<branch>` (wip), Push to ▸ (wip), Track Remote Branch ▸ (wip) — sep — **Diff Against Current** (✓ → compare view) — sep — Rename… (wip), Delete `<branch>` (wip, danger) — sep — **Copy Branch Name to Clipboard** (✓) — sep — Create Pull Request… (wip).

### File row (entity-aware, via `FileList` `onRowContextMenu(file, section)`)
Each consumer builds the menu for the row's section:
- **Committed file** (CommitDetail, section "changed"): **Copy Path To Clipboard** (✓); Log Selected…, Annotate Selected…, Reset to Commit…, Open Current Version, Open Selected Version, Show In Finder, Quick Look, External Diff → wip.
- **PR / compare file** (CompareDetail, section "changed"): **Copy Path** (✓); Open at head, Open at base, Show In Finder, External Diff → wip.
- **Staged file** (WorkingCopy "Staged"): **Unstage** (✓); **Copy Path** (✓); Show In Finder, Open → wip.
- **Unstaged file** (WorkingCopy "Unstaged"): **Stage** (✓); **Discard…** (✓, danger, confirm); **Copy Path** (✓); Show In Finder, Open → wip.
- **Untracked file** (WorkingCopy "Untracked"): **Stage** (✓); **Remove…** (✓, danger, confirm); **Copy Path** (✓); Add to .gitignore, Show In Finder → wip.

## Architecture notes

- `FileList` gains optional `onRowContextMenu?: (file: FileChange, section: string) => void`; it calls it from each row's `onContextMenu` (preventDefault). The row's left-click behavior is unchanged.
- The three file consumers each own a `ContextMenu` instance + a `buildMenu(file, section)`. WorkingCopyDetail's builder reuses `runMutation`/`setConfirm`; Commit/Compare builders are Copy-Path + WIP.
- Commit menu lives where `CommitRow` is rendered (railway) or via a prop from Workspace; Copy actions are local. Branch menu lives in `Sidebar`; "Diff Against Current" needs a Workspace callback (`onDiffRef(ref)` → enter compare with that branch as head vs current base).
- Left-click / keyboard selection and existing behaviors are untouched; the menu is additive.

## Testing

- **ContextMenu:** renders items + separators; WIP/disabled items don't fire `onClick`; enabled item fires `onClick` + closes; Escape + outside-click close; viewport clamping (position adjusts near an edge).
- **Menus:** right-click builds the right items for each entity; wired actions call the right thing (clipboard writeText with the expected string; stage/unstage/discard reuse the commands; Diff Against Current triggers compare); WIP items are disabled.

## Out of scope

- Actually implementing the WIP actions (they stay disabled — future write-loop / integrations).
- Nested submenus (Push to / Track Remote / Custom Actions render flat + WIP).
- Multi-select context actions ("Log Selected" implies selection — single-row only for now).
