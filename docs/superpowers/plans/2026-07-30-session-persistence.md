# Session / UI-State Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist UI/session state across app launches: ignore-whitespace, git-console open, scope (All/Current), hide-tests, filter-panel open, and auto-reopen the last-opened repository.

**Architecture:** A tiny `usePersistentState(key, initial)` hook (localStorage under the `omni-git.*` namespace, defensive parse) replaces the ephemeral `useState`s for the UI toggles. The last-opened repo is restored in `App` on mount (validated against the repo store), written on open / cleared on Back. Theme, file filters, column widths, panel sizes (incl. sidebar collapse) already persist — untouched.

**Tech Stack:** Existing (React 19 / TS7 / Vitest / Biome). No new deps.

**Spec:** design agreed in-thread; see roadmap memory "Session/UI-state persistence".

## Global Constraints

- Frontend only; TS7; Biome verbatim; theme-aware N/A.
- Persistence: `localStorage`, keys namespaced `omni-git.<name>` (consistent with `omni-git.theme`, `omni-git.file-filters`, `omni-git.railway-cols`). Defensive parse → fall back to the default, never throw.
- **Global** prefs (not per-repo). Making `hide-tests` / `filters-open` persisted means they're shared across the commit/PR/working-copy FileLists (by design).
- Do NOT touch theme (`useTheme`), filters (`useFileFilters`), column widths (`useColumnWidths`), or panel sizes (`autoSaveId`) — already persisted. Sidebar collapse already persists via `autoSaveId="omni-ws-outer"` (the ☰ toggle reads `isCollapsed()` from the panel) — leave as-is.
- `localStorage.clear()` in `beforeEach` for any test that reads/writes it.

## File Structure

- `src/ui/usePersistentState.ts` (new) + `src/ui/usePersistentState.test.ts` (new).
- `src/workspace/Workspace.tsx` (modify) — `ignoreWhitespace`, `consoleOpen`, `scope` → `usePersistentState`.
- `src/detail/FileList.tsx` (modify) — `hideTests`, `filtersOpen` → `usePersistentState`.
- `src/App.tsx` (modify) — restore/persist last-opened repo.

---

### Task 1: `usePersistentState` hook + apply to the UI toggles

**Files:**
- Create: `src/ui/usePersistentState.ts`, `src/ui/usePersistentState.test.ts`
- Modify: `src/workspace/Workspace.tsx`, `src/detail/FileList.tsx`

**Interfaces:**
- Produces: `usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void]` — same shape as `useState` (supports functional updater), persisting to `localStorage["omni-git." + key]`.

- [ ] **Step 1: Write the hook**

Create `src/ui/usePersistentState.ts`:
```ts
import { useCallback, useState } from "react"

// useState that mirrors its value into localStorage under `omni-git.<key>`,
// so it survives app relaunches. Defensive parse → falls back to `initial`.
export function usePersistentState<T>(
	key: string,
	initial: T,
): [T, (v: T | ((prev: T) => T)) => void] {
	const storageKey = `omni-git.${key}`
	const [value, setValue] = useState<T>(() => {
		try {
			const raw = localStorage.getItem(storageKey)
			return raw === null ? initial : (JSON.parse(raw) as T)
		} catch {
			return initial
		}
	})
	const set = useCallback(
		(v: T | ((prev: T) => T)) => {
			setValue((prev) => {
				const next =
					typeof v === "function" ? (v as (p: T) => T)(prev) : v
				try {
					localStorage.setItem(storageKey, JSON.stringify(next))
				} catch {}
				return next
			})
		},
		[storageKey],
	)
	return [value, set]
}
```

- [ ] **Step 2: Test the hook**

Create `src/ui/usePersistentState.test.ts` (`renderHook` + `act`, `localStorage.clear()` in `beforeEach`): initial value when nothing stored; value persists to `localStorage` on set (raw JSON under `omni-git.<key>`); functional updater works; a fresh `renderHook` with the same key reads the persisted value back; a corrupt stored value (`localStorage.setItem("omni-git.x","{bad")`) falls back to the default without throwing.

Run: `npx vitest run src/ui/usePersistentState.test.ts` → PASS.

- [ ] **Step 3: Apply in Workspace**

In `src/workspace/Workspace.tsx`, import `usePersistentState` and replace these three `useState` declarations (keep the same variable + setter names so call sites are unchanged):
```tsx
const [ignoreWhitespace, setIgnoreWhitespace] = usePersistentState("ignore-whitespace", false)
const [consoleOpen, setConsoleOpen] = usePersistentState("console-open", false)
const [scope, setScope] = usePersistentState<"all" | "current">("scope", "all")
```
(These currently live around lines 40–57. Leave everything else — `selected`, `refreshKey`, compare state, etc. — as plain `useState`.)

- [ ] **Step 4: Apply in FileList**

In `src/detail/FileList.tsx`, replace:
```tsx
const [hideTests, setHideTests] = usePersistentState("hide-tests", false)
const [filtersOpen, setFiltersOpen] = usePersistentState("filters-open", false)
```
(import `usePersistentState` from `../ui/usePersistentState`). All three FileList consumers now share these persisted keys — intended (global). Nav/filter logic unchanged.

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: green. Existing Workspace/FileList/WorkingCopyDetail tests still pass (the hook is a drop-in for `useState`; tests that don't pre-seed localStorage get the same defaults). If any test now bleeds state via localStorage across tests, add `localStorage.clear()` to that file's `beforeEach`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/usePersistentState.ts src/ui/usePersistentState.test.ts src/workspace/Workspace.tsx src/detail/FileList.tsx
git commit -m "feat: persist UI toggles (ignore-ws, console, scope, hide-tests, filters-open) via usePersistentState"
```

---

### Task 2: Auto-reopen the last repository

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `commands.listRepos()` (returns `Result<Repo[], …>`), `type Repo` (`{ id, name, path }`).

- [ ] **Step 1: Restore on mount, persist on open / clear on Back**

In `src/App.tsx`, use the `omni-git.last-repo` key (store the repo id). AVOID the mount-overwrite race by NOT using an effect keyed on `selected` (that would write `null` on the initial render before restore runs). Instead: restore once on mount, and write only from the open/back handlers.

```tsx
const LAST_REPO_KEY = "omni-git.last-repo"

// inside App():
const [selected, setSelected] = useState<Repo | null>(null)

// Restore the last-opened repo on launch, validated against the current store
// (so a removed/moved repo falls back to the launcher gracefully).
useEffect(() => {
	let storedId: string | null = null
	try {
		const raw = localStorage.getItem(LAST_REPO_KEY)
		storedId = raw === null ? null : (JSON.parse(raw) as string)
	} catch {
		storedId = null
	}
	if (storedId === null) {
		return
	}
	commands.listRepos().then((r) => {
		if (r.status === "ok") {
			const repo = r.data.find((x) => x.id === storedId)
			if (repo) {
				setSelected(repo)
			}
		}
	})
}, [])

function openRepo(repo: Repo) {
	try {
		localStorage.setItem(LAST_REPO_KEY, JSON.stringify(repo.id))
	} catch {}
	setSelected(repo)
}

function backToLauncher() {
	try {
		localStorage.removeItem(LAST_REPO_KEY)
	} catch {}
	setSelected(null)
}
```
Wire: `<Workspace ... onBack={backToLauncher} />` and `<RepoLauncher onOpen={openRepo} />` (replacing the inline `setSelected`). Keep the `key={selected.id}` on Workspace and the `gitOk` logic untouched.

- [ ] **Step 2: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: green. Update `src/App.test.tsx` if it asserts the launcher-first boot: its `listRepos` mock returns one repo but no `omni-git.last-repo` is set (add `localStorage.clear()` in `beforeEach`), so it still boots to the launcher — existing assertions hold. Optionally add a test: with `localStorage["omni-git.last-repo"]` set to an existing repo's id, App boots straight into `Workspace` (skips the launcher); with an unknown id, it shows the launcher.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat: auto-reopen the last-opened repository on launch"
```

---

## Self-Review

**Spec coverage:**
- ignore-whitespace, console, scope, hide-tests, filter-panel persisted → Task 1 ✓
- last-opened repo auto-reopen → Task 2 ✓
- theme / filters / columns / panel-sizes / sidebar-collapse → already persisted, untouched ✓

**Placeholder scan:** none.

**Type consistency:** `usePersistentState<T>` returns a `[T, setter]` tuple matching `useState`, so the Workspace/FileList call sites are drop-in (same names). `scope` typed `"all" | "current"`. Last-repo stores a string id, validated via `listRepos`.

**Known risks:**
1. **Mount-overwrite race** for last-repo — avoided by writing only in open/back handlers (not a `[selected]` effect). Task 2 Step 1 spells this out.
2. **Shared global hide-tests/filters-open** across the three FileList instances — intended; a toggle in one view affects the others (same model as file filters).
3. **Test bleed via localStorage** — add `localStorage.clear()` in `beforeEach` where needed; the hook + App both parse defensively.
4. **Removed/moved last repo** — `listRepos` validation → falls back to launcher; a repo whose path vanished but is still in the store would open and show git errors (user hits Back) — acceptable v1.
