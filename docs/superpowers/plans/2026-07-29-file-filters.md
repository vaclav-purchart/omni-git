# Unified File List + File Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the commit/PR and working-copy file lists into one shared `FileList` component, and add a persisted glob hide/highlight filter panel (plus "Hide tests" everywhere) — implemented once on `FileList`.

**Architecture:** Pure glob matcher + apply helper (`fileFilter.ts`); `localStorage` hook (`useFileFilters`); a controlled `FileFilterBar` (Hide-tests + collapsible pattern panel); a controlled `FileList` (sections, rows, filters, nav, highlight, optional toolbar + row-actions). `CommitDetail`/`CompareDetail`/`WorkingCopyDetail` become thin wrappers that load data and render `FileList`. `ChangedFilesList` is removed.

**Tech Stack:** React/TS 7, Vitest, Biome. No new deps.

**Spec:** `docs/superpowers/specs/2026-07-29-file-filters-design.md`.

## Global Constraints

- Frontend only; TS7; Biome verbatim; theme-aware (only `var(--…)` tokens).
- No new dependency — glob is a built-in translator.
- Persistence key `localStorage["omni-git.file-filters"]` (JSON `FileFilter[]`); defensive parse → `[]`; never crash.
- Keep "Hide tests" as a dedicated toggle; `is-test` dimming stays; generic filters additive; **hide wins** over highlight.
- Preserve wrapper behavior: `CommitDetail`/`CompareDetail` loop-safe load (genRef/reqRef/onFileDiffRef/aliveRef); `WorkingCopyDetail` loop-safe load + grouped data + action buttons + confirm dialog + `actionError` + raw-empty early return.
- `FileList` is **controlled** for selection: parent owns `activeKey` and the diff-open command; `FileList` calls `onOpen(section, path)`.

## File Structure

- `src/detail/fileFilter.ts` (+ `.test.ts`) — matcher/flags/apply.
- `src/detail/useFileFilters.ts` (+ `.test.ts`) — persistence hook.
- `src/detail/FileFilterBar.tsx` / `.css` (+ `.test.tsx`).
- `src/detail/FileList.tsx` / `.css` (+ `.test.tsx`) — unified list.
- `src/detail/CommitDetail.tsx`, `src/detail/CompareDetail.tsx` (modify) — render `FileList`.
- `src/detail/WorkingCopyDetail.tsx` (modify) — render `FileList` with sections + toolbar + row-actions.
- `src/detail/ChangedFilesList.tsx` + `ChangedFilesList.test.tsx` (delete).
- `src/detail/CommitDetail.css` (modify) — `.detail-file.is-highlight`.

---

### Task 1: Pure matcher + apply helper + persistence hook

**Files:** Create `src/detail/fileFilter.ts`, `src/detail/fileFilter.test.ts`, `src/detail/useFileFilters.ts`, `src/detail/useFileFilters.test.ts`

**Interfaces (produces):**
- `type FileFilter = { id: string; pattern: string; mode: "hide" | "highlight"; enabled: boolean }`
- `matchFilePattern(pattern: string, path: string): boolean`
- `fileFlags(path: string, filters: FileFilter[]): { hidden: boolean; highlighted: boolean }`
- `applyFileFilters<T extends { path: string }>(files: T[], filters: FileFilter[], hideTests: boolean): { visible: T[]; highlighted: Set<string>; testCount: number }`
- `useFileFilters(): { filters; addFilter(pattern, mode); updateFilter(id, patch); removeFilter(id); setEnabled(id, enabled) }`

- [ ] **Step 1: `fileFilter.ts`**

```ts
import { isTestFile } from "./fileClass"

export type FileFilter = {
	id: string
	pattern: string
	mode: "hide" | "highlight"
	enabled: boolean
}

function globToRegExp(glob: string): RegExp {
	let re = ""
	let i = 0
	while (i < glob.length) {
		const c = glob[i]
		if (c === "*") {
			if (glob[i + 1] === "*") {
				re += ".*"
				i += 2
				continue
			}
			re += "[^/]*"
			i += 1
			continue
		}
		if (c === "?") {
			re += "[^/]"
			i += 1
			continue
		}
		re += c.replace(/[.+^${}()|[\]\\]/, "\\$&")
		i += 1
	}
	return new RegExp(`^${re}$`, "i")
}

export function matchFilePattern(pattern: string, path: string): boolean {
	const p = pattern.trim()
	if (p === "") {
		return false
	}
	const target = p.includes("/") ? path : (path.split("/").pop() ?? path)
	return globToRegExp(p).test(target)
}

export function fileFlags(
	path: string,
	filters: FileFilter[],
): { hidden: boolean; highlighted: boolean } {
	let hidden = false
	let highlighted = false
	for (const f of filters) {
		if (!f.enabled || !matchFilePattern(f.pattern, path)) {
			continue
		}
		if (f.mode === "hide") {
			hidden = true
		} else {
			highlighted = true
		}
	}
	return { hidden, highlighted }
}

export function applyFileFilters<T extends { path: string }>(
	files: T[],
	filters: FileFilter[],
	hideTests: boolean,
): { visible: T[]; highlighted: Set<string>; testCount: number } {
	const visible: T[] = []
	const highlighted = new Set<string>()
	let testCount = 0
	for (const f of files) {
		const isTest = isTestFile(f.path)
		if (isTest) {
			testCount += 1
		}
		const flags = fileFlags(f.path, filters)
		if (flags.hidden || (hideTests && isTest)) {
			continue
		}
		visible.push(f)
		if (flags.highlighted) {
			highlighted.add(f.path)
		}
	}
	return { visible, highlighted, testCount }
}
```

- [ ] **Step 2: `fileFilter.test.ts`** — `matchFilePattern` (basename vs full-path anchoring; `*.test.*` matches nested; `dist/**`; `?`; literal `.`; case-insensitive; empty never matches); `fileFlags` (disabled ignored; hide+highlight → both true); `applyFileFilters` (hide + hideTests removal; `testCount` counts all tests; `highlighted` only visible; hide-wins). Run: `npx vitest run src/detail/fileFilter.test.ts` → PASS.

- [ ] **Step 3: `useFileFilters.ts`**

```ts
import { useCallback, useState } from "react"
import type { FileFilter } from "./fileFilter"

const KEY = "omni-git.file-filters"

function load(): FileFilter[] {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return []
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter(
			(f): f is FileFilter =>
				f &&
				typeof f.id === "string" &&
				typeof f.pattern === "string" &&
				(f.mode === "hide" || f.mode === "highlight") &&
				typeof f.enabled === "boolean",
		)
	} catch {
		return []
	}
}

function save(next: FileFilter[]) {
	try {
		localStorage.setItem(KEY, JSON.stringify(next))
	} catch {}
}

export function useFileFilters() {
	const [filters, setFilters] = useState<FileFilter[]>(load)

	const addFilter = useCallback((pattern: string, mode: FileFilter["mode"]) => {
		const p = pattern.trim()
		if (p === "") return
		setFilters((prev) => {
			const next = [
				...prev,
				{ id: crypto.randomUUID(), pattern: p, mode, enabled: true },
			]
			save(next)
			return next
		})
	}, [])

	const updateFilter = useCallback(
		(id: string, patch: Partial<Omit<FileFilter, "id">>) => {
			setFilters((prev) => {
				const next = prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
				save(next)
				return next
			})
		},
		[],
	)

	const removeFilter = useCallback((id: string) => {
		setFilters((prev) => {
			const next = prev.filter((f) => f.id !== id)
			save(next)
			return next
		})
	}, [])

	const setEnabled = useCallback(
		(id: string, enabled: boolean) => updateFilter(id, { enabled }),
		[updateFilter],
	)

	return { filters, addFilter, updateFilter, removeFilter, setEnabled }
}
```

- [ ] **Step 4: `useFileFilters.test.ts`** — `renderHook` + `act`; `localStorage.clear()` in `beforeEach`. Add (persists + appears); empty/whitespace not added; setEnabled/updateFilter/removeFilter persist; a fresh `renderHook` reads back; corrupt value (`"x"`, `'{"a":1}'`) → `[]`. Run → PASS.

- [ ] **Step 5: Commit** `feat: file-filter glob matcher + persisted useFileFilters hook`

---

### Task 2: `FileFilterBar` component

**Files:** Create `src/detail/FileFilterBar.tsx`, `src/detail/FileFilterBar.css`, `src/detail/FileFilterBar.test.tsx`

**Interfaces (produces):** `<FileFilterBar testCount hideTests onToggleHideTests filters onAddFilter onUpdateFilter onRemoveFilter onSetEnabled />` — prop types mirror `useFileFilters`'s return + `{ testCount: number; hideTests: boolean; onToggleHideTests: () => void }`.

- [ ] **Step 1: `FileFilterBar.tsx`** — controlled cluster; owns only panel-open + add-row draft (pattern text + mode).
  - Row (`.filter-bar`): the **Hide tests** button (only when `testCount > 0`; label `Hide tests (N)`/`Show tests (N)`; classes `detail-hide-tests` + `is-on`; `onClick={onToggleHideTests}`), and the **filter icon** (`.filter-icon-btn`, `type="button"`, `title="File filters — hide/highlight by pattern"`, `aria-label="File filters"`, `aria-expanded={open}`) with a ~14px inline funnel SVG (`currentColor`). Add `is-active` + a `.filter-active-dot` when `filters.some(f => f.enabled)`.
  - When open, `.filter-panel` (`role="group"`, `aria-label="File filters"`): add-row = `<input placeholder="e.g. *.test.*  or  dist/**">` + mode `<select>` (`hide`/`highlight`) + **Add** (disabled when draft blank; Enter in input also adds → `onAddFilter(draft.trim(), mode)` then clear draft); then the filter list — each row: enable `<input type="checkbox" checked>` → `onSetEnabled(id, checked)`, the pattern text, mode `<select value>` → `onUpdateFilter(id, { mode })`, remove `<button aria-label="Remove filter">✕</button>` → `onRemoveFilter(id)`; empty hint when none.

- [ ] **Step 2: `FileFilterBar.css`** — theme tokens only; `.filter-icon-btn` sized like `.detail-hide-tests`; `.is-active`/`.filter-active-dot` use `var(--accent)`; `.filter-panel` bordered (`var(--surface)`/`var(--border)`).

- [ ] **Step 3: `FileFilterBar.test.tsx`** — panel hidden until icon click (`aria-expanded`); Add via button + Enter; Add disabled when blank; checkbox → `onSetEnabled`; mode select → `onUpdateFilter({mode})`; ✕ → `onRemoveFilter`; active-dot only when some enabled; Hide-tests shows when `testCount>0` + calls `onToggleHideTests`. Run → PASS.

- [ ] **Step 4: Commit** `feat: FileFilterBar — hide-tests + collapsible glob filter panel`

---

### Task 3: The unified `FileList` component

**Files:** Create `src/detail/FileList.tsx`, `src/detail/FileList.css`, `src/detail/FileList.test.tsx`; modify `src/detail/CommitDetail.css` (add `.detail-file.is-highlight`).

**Interfaces:**
- Consumes: `useFileFilters`, `applyFileFilters`, `FileFilterBar`, `MiddlePath`, `isTestFile` (dimming via `applyFileFilters`/row class).
- Produces:
  ```ts
  type FileSection = { key: string; label?: string; files: FileChange[] }
  type FileListProps = {
    ariaLabel: string
    sections: FileSection[]
    activeKey: { section: string; path: string } | null
    onOpen: (section: string, path: string) => void
    subject?: React.ReactNode
    toolbar?: React.ReactNode
    renderRowActions?: (file: FileChange, section: string) => React.ReactNode
  }
  ```

- [ ] **Step 1: `FileList.tsx`**

Behavior:
- `const { filters, addFilter, updateFilter, removeFilter, setEnabled } = useFileFilters()`; `const [hideTests, setHideTests] = useState(false)`; `const activeRef = useRef<HTMLButtonElement>(null)`.
- Per section, `applyFileFilters(section.files, filters, hideTests)` → build `viewSections = sections.map(s => ({ ...s, visible, highlighted }))`; `testCount` = sum of per-section `testCount`; `rawTotal` = sum of `section.files.length`; `visibleTotal` = sum of `visible.length`.
- `flattened = viewSections.flatMap(s => s.visible.map(f => ({ section: s.key, path: f.path })))` for nav.
- Header row (`.detail-subject-row`): `{subject}` (if given) + `{toolbar}` (if given) + `<FileFilterBar testCount hideTests onToggleHideTests={() => setHideTests(h=>!h)} filters onAddFilter={addFilter} onUpdateFilter={updateFilter} onRemoveFilter={removeFilter} onSetEnabled={setEnabled} />`.
- Body (`.detail`, `role="listbox"`, `tabIndex=0`, `aria-label={ariaLabel}`, `onKeyDown`): for each `viewSection`, if it has a `label` render a `.wc-section-header` (`{label}` + visible count); then a `<ul className="detail-files">` of its `visible` rows. Row `<li key={`${s.key}:${f.path}`}>`:
  - a `<button className={`detail-file ${isActive?"is-active":""} ${isTestFile(f.path)?"is-test":""} ${s.highlighted.has(f.path)?"is-highlight":""}`} ref={isActive?activeRef:undefined} onClick={() => onOpen(s.key, f.path)}>` with the status badge (`s-${f.status[0]}`) + `<MiddlePath>`,
  - where `isActive = activeKey?.section === s.key && activeKey?.path === f.path`,
  - then, if `renderRowActions`, `{renderRowActions(f, s.key)}` (rendered as a sibling of the button, e.g. inside a `.detail-row` wrapper `<li>` so actions sit beside the file button — mirror the current `WorkingCopyDetail` markup of `<button/> + <span className="wc-file-actions">…`).
- `move(delta)`: like the current lists but over `flattened` + `activeKey`; on empty do nothing; call `onOpen(next.section, next.path)`. ArrowUp/Down in `onKeyDown` call `move(∓1)` with `preventDefault`.
- `useEffect(() => activeRef.current?.scrollIntoView({ block: "nearest" }), [activeKey])`.
- If `rawTotal > 0 && visibleTotal === 0`, render a `.detail-empty`-style hint "All files filtered out." UNDER the header (still show the header/filter bar so the user can adjust). If `rawTotal === 0`, render nothing extra (wrappers handle their own genuine-empty messaging before mounting `FileList`, but `FileList` tolerates empty sections).

- [ ] **Step 2: `FileList.css` + highlight style**

Move/keep the generic list styles working (reuse existing `.detail`, `.detail-subject-row`, `.detail-files`, `.detail-file`, `.detail-status`, `.wc-section-header` classes already defined in `CommitDetail.css`/`WorkingCopyDetail.css`; add anything `FileList`-specific to `FileList.css`). In `src/detail/CommitDetail.css` add `.detail-file.is-highlight` — left accent (`box-shadow: inset 2px 0 0 var(--accent)`) + `background: color-mix(in srgb, var(--accent) 12%, transparent)`; visually distinct from `.is-active`/`.is-test`.

- [ ] **Step 3: `FileList.test.tsx`**

Render `FileList` directly with fake sections. Assert: rows render per section with labels + visible counts; clicking a row calls `onOpen(section, path)`; a section with no `label` shows no header; a hide filter (drive it by adding via the FileFilterBar UI, or seed `localStorage` before render) removes matching rows and skips them in ArrowDown nav; a highlight filter adds `is-highlight`; `renderRowActions` output appears and clicking an action button does NOT call `onOpen` (the wrapper is expected to `stopPropagation`, so the test's action element should call it — verify `onOpen` not fired); ArrowDown/Up move `onOpen` across sections and clamp. `localStorage.clear()` in `beforeEach`. Run: `npx vitest run src/detail/FileList.test.tsx` → PASS.

- [ ] **Step 4: Commit** `feat: unified FileList (sections + filters + hide-tests + nav)`

---

### Task 4: Move `CommitDetail` + `CompareDetail` onto `FileList`; delete `ChangedFilesList`

**Files:** Modify `src/detail/CommitDetail.tsx`, `src/detail/CompareDetail.tsx`; delete `src/detail/ChangedFilesList.tsx` + `src/detail/ChangedFilesList.test.tsx`.

- [ ] **Step 1: `CommitDetail`**

Currently it tracks `activePath` and renders `<ChangedFilesList subject files activePath onOpen={openFile}/>`. Change:
- Track `const [activePath, setActivePath] = useState<string | null>(null)` as now; render:
  ```tsx
  <FileList
    ariaLabel="Changed files"
    subject={selectedCommit.subject}
    sections={[{ key: "changed", files }]}
    activeKey={activePath === null ? null : { section: "changed", path: activePath }}
    onOpen={(_, path) => openFile(path)}
  />
  ```
- `openFile(path)` sets `activePath` + loads `file_diff` (unchanged loop-safe body). Keep the `selectedCommit === null` empty return.

- [ ] **Step 2: `CompareDetail`** — same pattern: `ariaLabel="Changed files"`, `subject={`${head} ← ${base}`}`, one section `{ key: "changed", files }`, `activeKey` from its `activePath`, `onOpen={(_, path) => openFile(path)}`. Keep its error/empty returns + loop-safe load.

- [ ] **Step 3: Delete `ChangedFilesList`** (`.tsx` + `.test.tsx`); remove any imports. Migrate any still-relevant assertions from `ChangedFilesList.test.tsx` into `FileList.test.tsx` (Task 3) if not already covered.

- [ ] **Step 4: Verify** `npx vitest run && npm run build && npm run lint` → green. Fix any test that imported `ChangedFilesList`.

- [ ] **Step 5: Commit** `refactor: CommitDetail/CompareDetail render FileList; drop ChangedFilesList`

---

### Task 5: Move `WorkingCopyDetail` onto `FileList` (grouping + actions + parity)

**Files:** Modify `src/detail/WorkingCopyDetail.tsx`, `src/detail/WorkingCopyDetail.css`.

- [ ] **Step 1: Render `FileList` with three sections + actions + toolbar**

Keep ALL existing wrapper logic (workingStatus load with genRef/reqRef/aliveRef; `openFile(section, path)` loop-safe; `runMutation`; `confirm` state + `<ConfirmDialog>`; `actionError` banner; the raw-empty "No uncommitted changes." early return on `staged/unstaged/untracked`; the `[ignoreWhitespace]` re-fetch effect using `activeKey`). Replace the hand-rolled groups/toolbar/keyboard-nav JSX with:
```tsx
<FileList
  ariaLabel="Uncommitted changes"
  toolbar={
    <>
      <button className="wc-toolbar-btn" disabled={unstaged.length + untracked.length === 0}
        onClick={() => runMutation(commands.stageAll(repoPath))}>Stage all</button>
      <button className="wc-toolbar-btn" disabled={staged.length === 0}
        onClick={() => runMutation(commands.unstageAll(repoPath))}>Unstage all</button>
    </>
  }
  sections={[
    { key: "Staged", label: "Staged", files: staged },
    { key: "Unstaged", label: "Unstaged", files: unstaged },
    { key: "Untracked", label: "Untracked", files: untracked },
  ]}
  activeKey={activeKey}
  onOpen={(section, path) => openFile(section as WorkingSection, path)}
  renderRowActions={(f, section) => (
    <span className="wc-file-actions">
      {section === "Staged" && (
        <button className="wc-action-btn" onClick={(e) => { e.stopPropagation(); runMutation(commands.unstageFile(repoPath, f.path)) }}>Unstage</button>
      )}
      {section === "Unstaged" && (<>
        <button className="wc-action-btn" onClick={(e) => { e.stopPropagation(); runMutation(commands.stageFile(repoPath, f.path)) }}>Stage</button>
        <button className="wc-action-btn wc-action-danger" onClick={(e) => { e.stopPropagation(); setConfirm({ path: f.path, untracked: false }) }}>Discard</button>
      </>)}
      {section === "Untracked" && (<>
        <button className="wc-action-btn" onClick={(e) => { e.stopPropagation(); runMutation(commands.stageFile(repoPath, f.path)) }}>Stage</button>
        <button className="wc-action-btn wc-action-danger" onClick={(e) => { e.stopPropagation(); setConfirm({ path: f.path, untracked: true }) }}>Remove</button>
      </>)}
    </span>
  )}
/>
```
- `activeKey` is already `{ section: WorkingSection; path } | null` — pass as-is (the `section` is a string, compatible with `FileList`'s `{section: string}`). `onOpen` casts `section` back to `WorkingSection`.
- Remove the now-unused local `hideTests`/`isTestFile` imports and the hand-rolled `groups`/`flattened`/`move`/`onKeyDown`/section JSX — `FileList` owns them now. Keep `SECTIONS` only if still referenced (likely delete).
- Render the `actionError` banner + `<ConfirmDialog>` OUTSIDE/around `<FileList>` (as today), and keep the early returns (`error`, raw-empty, `!loaded`).

- [ ] **Step 2: CSS** — the row-actions markup: ensure `FileList`'s row wraps `<button.detail-file>` + `renderRowActions` output so `.wc-file-actions` still sits beside the file (adjust `FileList.css`/`WorkingCopyDetail.css` as needed; `.detail-file.is-highlight` already covers highlight). Keep `.wc-toolbar-btn`/`.wc-action-btn`/`.wc-action-danger` styles.

- [ ] **Step 3: Verify + tests** `npx vitest run && npm run build && cargo build --manifest-path src-tauri/Cargo.toml && npm run lint`. Update `WorkingCopyDetail.test.tsx`: keep stage/unstage/discard/confirm/nav tests working through the new markup (queries may need adjusting to the `FileList` DOM); add: "Hide tests" now appears (via the bar) and hides test files across groups; a hide filter removes a matching row from a group. Keep the loop-safe/dual-key/ws-flip tests green. Run → green.

- [ ] **Step 4: Commit** `refactor: WorkingCopyDetail renders FileList (grouping + actions + filters/hide-tests)`

---

## Self-Review

**Spec coverage:**
- Unify into one `FileList`; commit/PR = features off → Tasks 3–5 ✓
- Glob hide/highlight toggle → Task 1 + Task 2 ✓
- Persist globally → Task 1 ✓
- Filter icon → collapsible panel, tooltip, active dot → Task 2 ✓
- Keep Hide-tests + add to working copy → Tasks 2–5 (it's on `FileList`, so everywhere) ✓
- All three views → Tasks 4 + 5 ✓
- Highlight styling distinct → Task 3 CSS ✓

**Placeholder scan:** none.

**Type consistency:** `FileFilter` in `fileFilter.ts` used by hook/bar/FileList; `applyFileFilters<T extends {path}>` used with `FileChange`; `FileList` `activeKey`/`onOpen` use `{section: string; path}` and `(section, path)` consistently; `WorkingCopyDetail`'s `activeKey` is `{section: WorkingSection; path}` (assignable to `{section: string; path}`) and `onOpen` casts back; `FileFilterBar` props match `useFileFilters` return.

**Known risks:**
1. **Biggest churn is Task 5** — but the wrapper keeps its data-load/actions/confirm/loop-safe logic; only list *rendering* moves to `FileList` via props. Existing WorkingCopyDetail tests likely need DOM-query updates (not behavior changes) — call this out in review.
2. **Controlled selection** — `FileList` never owns `activeKey`; parents pass it and handle `onOpen`. Keyboard nav in `FileList` computes next from its own `visible` + the passed `activeKey`. If a filter hides the active file, nav just starts from the first visible on next keypress (acceptable).
3. **Row-actions + stopPropagation** — actions live in the wrapper's `renderRowActions` and must `stopPropagation` (kept from current code); `FileList` renders them as siblings of the row button so a bubble can't reach `onOpen` anyway. Task 3 test asserts action clicks don't fire `onOpen`.
4. **Deleting `ChangedFilesList`** — ensure no other importers remain (grep) before deleting; migrate unique test assertions to `FileList.test.tsx`.
5. **Glob anchoring** simplified gitignore-style — documented + tested; not full gitignore.
6. **localStorage bleed in tests** — clear in `beforeEach` for hook/FileList/integration tests.
