# Unified File List + File Filters — Design Spec

**Status:** Approved 2026-07-29. Unifies the commit, PR-compare, and working-copy file lists into one shared `FileList` component, and adds a configurable glob-based hide/highlight filter panel (plus keeping "Hide tests", now available everywhere).

## Goal

1. Collapse the duplicated file-list rendering (`ChangedFilesList` + the bespoke list inside `WorkingCopyDetail`) into **one `FileList` component**. Commit/PR is just `FileList` with grouping and row-actions turned off.
2. On that shared component, add a **glob filter panel** (hide / highlight patterns, toggleable, persisted) alongside the existing **"Hide tests"** toggle — so all three views get both, implemented once.

## Decisions (from brainstorming)

- **Unify** the file lists into a single `FileList` (option A). The differences between views (grouping, row actions, open-key, data source) are props/config, not separate components.
- **Matching:** glob, via a small built-in glob→regex matcher (no dependency).
- **Persistence:** filters are global, in `localStorage` (`omni-git.file-filters`).
- **Scope:** commit, PR-compare, and working-copy views — all via `FileList`.
- **"Hide tests"** is kept as a dedicated quick toggle, independent of and additive to the generic filters; test files stay dimmed (`is-test`) regardless.

## The `FileList` component

`FileList` owns everything generic to "show files → click → open diff": sections, filter panel + Hide-tests, filter application, highlight, keyboard nav, active-row scroll, test dimming, and the status-badge + path row. It is **controlled** for selection (parent owns which file is open, because the parent loads the diff).

```ts
type FileSection = {
  key: string                 // section id; flat/single-section views use a constant, e.g. "changed"
  label?: string              // header text; omitted → no section header (flat list)
  files: FileChange[]         // RAW files for this section (FileList applies filters)
}

type FileListProps = {
  ariaLabel: string
  sections: FileSection[]
  activeKey: { section: string; path: string } | null
  onOpen: (section: string, path: string) => void
  subject?: ReactNode                                   // e.g. commit subject / "head ← base"
  toolbar?: ReactNode                                   // extra header controls (e.g. Stage all / Unstage all)
  renderRowActions?: (file: FileChange, section: string) => ReactNode  // e.g. Stage/Unstage/Discard
}
```

`FileList` internally:
- calls `useFileFilters()` + holds `hideTests` + filter-panel-open state,
- runs `applyFileFilters` per section → visible files, highlighted set, and a summed `testCount`,
- renders the header row: `subject?` + `toolbar?` + `<FileFilterBar>`,
- renders each section (a header with `label` + visible count when `label` is set), then its visible rows,
- a row = status badge + `MiddlePath`, classes `is-active` (matches `activeKey`), `is-test` (dimmed), `is-highlight`; `onClick → onOpen(section, path)`; `renderRowActions?` appended,
- `role="listbox"` + `tabIndex=0`; ArrowUp/Down navigate the flattened visible files (across sections) and call `onOpen`; the active row scrolls into view,
- shows a subtle "All files filtered out" hint when there are raw files but nothing visible (so an over-eager filter is obvious).

Parents shrink to **data-owning wrappers**: they load data, own `activeKey` + the diff-open command, and pass sections (+ optional toolbar/actions). They keep their own concerns (loop-safe loading, confirm dialog, action errors). `ChangedFilesList` is removed; `CommitDetail`/`CompareDetail`/`WorkingCopyDetail` render `FileList`.

### Per-view configuration

- **CommitDetail / CompareDetail:** one section `{ key: "changed", files }` (no `label` → no header), `subject` = commit subject / `head ← base`, no `toolbar`, no `renderRowActions`. `onOpen(_, path)` → `file_diff` / `branch_file_diff`.
- **WorkingCopyDetail:** three sections `Staged` / `Unstaged` / `Untracked` (with labels), `toolbar` = Stage all / Unstage all, `renderRowActions(file, section)` = Stage/Unstage/Discard(+Remove) buttons, `onOpen(section, path)` → `working_file_diff(section, …)`. The confirm dialog + `actionError` banner + the raw-empty "No uncommitted changes." early-return stay in the wrapper.

## Data Model, Glob, Behavior, Persistence

(unchanged by the unification)

```ts
type FileFilter = { id: string; pattern: string; mode: "hide" | "highlight"; enabled: boolean }
```
- **Glob** (`matchFilePattern`, gitignore-style anchoring): no `/` → match basename (`*.test.*` matches `src/a/foo.test.ts`); with `/` → match full path (`dist/**`). `**`→`.*`, `*`→`[^/]*`, `?`→`[^/]`, else escaped; anchored, case-insensitive; empty/whitespace never matches.
- **Behavior:** enabled hide filters + (if on) Hide-tests remove files from the visible list AND nav; highlight filters emphasize still-visible files; **hide wins** over highlight.
- **Persistence:** `localStorage["omni-git.file-filters"]`, JSON array; defensive parse → `[]`.

## Shared Modules

- `src/detail/fileFilter.ts` — `FileFilter`, `matchFilePattern`, `fileFlags`, `applyFileFilters<T extends {path}>`. Pure, tested.
- `src/detail/useFileFilters.ts` — `localStorage` hook: `{ filters, addFilter, updateFilter, removeFilter, setEnabled }`.
- `src/detail/FileFilterBar.tsx` (+ `.css`) — Hide-tests button + filter-icon (inline funnel SVG, tooltip, active-dot) + collapsible pattern panel (add-row + list with enable/mode/remove). Controlled via props.
- `src/detail/FileList.tsx` (+ `.css`) — the unified component above.

## Highlight Styling

`.detail-file.is-highlight` — left accent border + subtle `color-mix(in srgb, var(--accent) 12%, transparent)` tint, distinct from `is-active` and `is-test`. Tokens only.

## Testing

- **Pure:** `matchFilePattern` (anchoring, `*`/`**`/`?`, case, escaping, empty), `fileFlags` (hide-wins, disabled ignored), `applyFileFilters` (hide + hide-tests, testCount counts all tests, highlighted only-visible).
- **Hook:** `useFileFilters` add/remove/toggle/update round-trip + corrupt-value → `[]`.
- **Component:** `FileFilterBar` (panel toggle, add via button/Enter, enable/mode/remove callbacks, active-dot, Hide-tests). `FileList` (renders sections/labels/counts; click → `onOpen(section, path)`; hide filter removes rows + skips nav; highlight adds class; keyboard nav across sections; `renderRowActions` rendered; action clicks don't trigger `onOpen`).
- **Integration:** `CommitDetail`/`CompareDetail` still open diffs; `WorkingCopyDetail` stage/unstage/discard/confirm/nav + Hide-tests + filters across groups all work.

## Out of Scope

- Regex/substring modes (glob only); per-repo filter sets (global only); filtering diff content; import/export of filters.
- Merging the wrappers' data-loading (each keeps its own commands + loop-safe logic); only the list rendering unifies.
