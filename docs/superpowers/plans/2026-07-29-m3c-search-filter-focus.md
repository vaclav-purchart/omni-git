# Milestone 3c — Search / Filter / Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user find commits in the graph — a filter bar with a message search and an author filter that **highlights matches in place and jumps between them** (next/prev), keeping the full graph intact — and make a sidebar branch/tag click **load more pages until the tip commit is found** so selecting a deep branch always works.

**Architecture:** A pure `commitMatches`/`findMatches` module classifies which loaded commits match the current filter. A small `RailwaySearch` bar sits at the top of the railway; `CommitRailway` computes the matching indices (memoized), passes a "matched" flag to each row for highlighting, tracks the current match, and scrolls+selects on next/prev. The existing `selectHash` effect gains a load-until-found loop (bounded). Matching is over the currently-loaded commits (client-side), which is what "keep the graph, highlight & jump" requires. This builds on the merged M3/M3b graph + resizable-columns railway.

**Tech Stack:** Existing (React 18, TS7, react-virtuoso, Vitest, Biome). No new deps.

## Global Constraints

- **Frontend only** — no backend/IPC changes; matching is client-side over loaded `CommitSummary[]`.
- **Keep the graph intact** — filtering must NOT remove rows (that would break lane continuity); it highlights + jumps.
- **Preserve existing railway behavior** — keyboard nav (↑/↓/Home/End), the `selectHash` effect + its clear-on-consume fix, `computeGraph` memo, resizable columns/header, and the `graphWidth`/`--col-*` wiring all stay intact.
- **TS7; Biome 2.5.4 verbatim** (tab indent, double quotes, semicolons asNeeded, trailing commas all). `npm run format` then `npm run lint`; the one info-level biome notice is expected.
- **Theme-aware** highlight color from tokens (e.g. a translucent accent/warning); readable light+dark.
- **Frequent commits**; commit author if unset: `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.

## File Structure

- `src/railway/commitMatch.ts` + `.test.ts` (new) — pure filter/match logic.
- `src/railway/RailwaySearch.tsx` (new) — the filter bar (search + author + count + prev/next + clear).
- `src/railway/CommitRailway.tsx` (modify) — filter state, matched set, current-match jump, render the bar, highlight rows, load-until-found.
- `src/railway/CommitRow.tsx` (modify) — accept a `matched` flag → highlight class.
- `src/railway/CommitRailway.css` (modify) — search bar + `.is-matched` row style.

---

### Task 1: Pure match logic (TDD)

**Files:**
- Create: `src/railway/commitMatch.ts`, `src/railway/commitMatch.test.ts`

**Interfaces:**
- Produces:
  - `type CommitFilter = { query: string; author: string }`
  - `commitMatches(commit: { subject: string; author_name: string; hash: string }, filter: CommitFilter): boolean` — a commit matches when (query is empty OR its `subject` OR `hash` contains query, case-insensitive) AND (author is empty OR `author_name` contains author, case-insensitive). Both filters empty → matches everything.
  - `isFilterActive(filter: CommitFilter): boolean` — true if either field is non-empty (after trim).
  - `findMatches(commits: Array<{ subject; author_name; hash }>, filter: CommitFilter): number[]` — indices of matching commits, in order; returns `[]` when the filter is inactive.

- [ ] **Step 1: Write the failing tests**

Create `src/railway/commitMatch.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { commitMatches, findMatches, isFilterActive } from "./commitMatch"

const c = (subject: string, author_name: string, hash = "abc123") => ({
	subject,
	author_name,
	hash,
})

describe("commitMatches", () => {
	it("matches everything when the filter is empty", () => {
		expect(commitMatches(c("anything", "Ada"), { query: "", author: "" })).toBe(true)
	})
	it("matches subject case-insensitively", () => {
		expect(commitMatches(c("Fix the Bug", "Ada"), { query: "bug", author: "" })).toBe(true)
		expect(commitMatches(c("Fix the Bug", "Ada"), { query: "feature", author: "" })).toBe(false)
	})
	it("matches hash prefix", () => {
		expect(commitMatches(c("x", "Ada", "deadbeef"), { query: "dead", author: "" })).toBe(true)
	})
	it("ANDs author with query", () => {
		expect(commitMatches(c("fix", "Ada Lovelace"), { query: "fix", author: "ada" })).toBe(true)
		expect(commitMatches(c("fix", "Bob"), { query: "fix", author: "ada" })).toBe(false)
	})
})

describe("isFilterActive", () => {
	it("is false only when both fields are blank/whitespace", () => {
		expect(isFilterActive({ query: "", author: "" })).toBe(false)
		expect(isFilterActive({ query: "  ", author: " " })).toBe(false)
		expect(isFilterActive({ query: "x", author: "" })).toBe(true)
		expect(isFilterActive({ query: "", author: "y" })).toBe(true)
	})
})

describe("findMatches", () => {
	it("returns matching indices, empty when inactive", () => {
		const commits = [c("fix a", "Ada"), c("feat b", "Bob"), c("fix c", "Ada")]
		expect(findMatches(commits, { query: "fix", author: "" })).toEqual([0, 2])
		expect(findMatches(commits, { query: "", author: "" })).toEqual([])
	})
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/railway/commitMatch.test.ts`
Expected: FAIL — cannot find `./commitMatch`.

- [ ] **Step 3: Implement**

Create `src/railway/commitMatch.ts`:
```ts
export type CommitFilter = { query: string; author: string }
type Matchable = { subject: string; author_name: string; hash: string }

export function isFilterActive(filter: CommitFilter): boolean {
	return filter.query.trim() !== "" || filter.author.trim() !== ""
}

export function commitMatches(commit: Matchable, filter: CommitFilter): boolean {
	const q = filter.query.trim().toLowerCase()
	const a = filter.author.trim().toLowerCase()
	const queryOk =
		q === "" ||
		commit.subject.toLowerCase().includes(q) ||
		commit.hash.toLowerCase().includes(q)
	const authorOk = a === "" || commit.author_name.toLowerCase().includes(a)
	return queryOk && authorOk
}

export function findMatches(commits: Matchable[], filter: CommitFilter): number[] {
	if (!isFilterActive(filter)) {
		return []
	}
	const out: number[] = []
	for (let i = 0; i < commits.length; i++) {
		if (commitMatches(commits[i], filter)) {
			out.push(i)
		}
	}
	return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/railway/commitMatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pure commit filter/match logic"
```

---

### Task 2: Filter bar + highlight + jump

**Files:**
- Create: `src/railway/RailwaySearch.tsx`
- Modify: `src/railway/CommitRailway.tsx`, `src/railway/CommitRow.tsx`, `src/railway/CommitRailway.css`

**Interfaces:**
- Consumes: `commitMatch` (Task 1).
- Produces:
  - `<RailwaySearch filter onFilterChange matchCount currentMatch onPrev onNext onClear />` — a slim bar: a search input (placeholder "Search message or hash…"), an author input (placeholder "Author"), a "`k of N`" match counter (only when the filter is active), prev/next buttons (disabled when no matches), and a clear button.
  - `CommitRow` gains a `matched: boolean` prop → adds `is-matched` class.

- [ ] **Step 1: `CommitRow` highlight prop**

In `src/railway/CommitRow.tsx`, add `matched: boolean` to the props and include `is-matched` in the root className when true (alongside `is-selected`). No other change. (Its test passes `matched={false}` — update the test's two renders to include `matched={false}`; keep existing assertions.)

- [ ] **Step 2: `RailwaySearch` component**

Create `src/railway/RailwaySearch.tsx`:
```tsx
import type { CommitFilter } from "./commitMatch"

export function RailwaySearch({
	filter,
	onFilterChange,
	active,
	matchCount,
	currentMatch,
	onPrev,
	onNext,
	onClear,
}: {
	filter: CommitFilter
	onFilterChange: (f: CommitFilter) => void
	active: boolean
	matchCount: number
	currentMatch: number // 1-based index of the focused match, 0 when none
	onPrev: () => void
	onNext: () => void
	onClear: () => void
}) {
	return (
		<div className="railway-search">
			<input
				className="railway-search-input"
				placeholder="Search message or hash…"
				value={filter.query}
				onChange={(e) => onFilterChange({ ...filter, query: e.target.value })}
			/>
			<input
				className="railway-search-author"
				placeholder="Author"
				value={filter.author}
				onChange={(e) => onFilterChange({ ...filter, author: e.target.value })}
			/>
			{active && (
				<div className="railway-search-nav">
					<span className="railway-search-count">
						{matchCount === 0 ? "no matches" : `${currentMatch} of ${matchCount}`}
					</span>
					<button
						type="button"
						className="btn btn-icon"
						aria-label="Previous match"
						title="Previous match"
						disabled={matchCount === 0}
						onClick={onPrev}
					>
						↑
					</button>
					<button
						type="button"
						className="btn btn-icon"
						aria-label="Next match"
						title="Next match"
						disabled={matchCount === 0}
						onClick={onNext}
					>
						↓
					</button>
					<button
						type="button"
						className="btn btn-icon"
						aria-label="Clear search"
						title="Clear search"
						onClick={onClear}
					>
						✕
					</button>
				</div>
			)}
		</div>
	)
}
```

- [ ] **Step 3: Wire into `CommitRailway`**

In `src/railway/CommitRailway.tsx`:
- Add state: `const [filter, setFilter] = useState<CommitFilter>({ query: "", author: "" })` and `const [matchPos, setMatchPos] = useState(0)` (index into the matches array; 0-based).
- `const active = isFilterActive(filter)`.
- `const matches = useMemo(() => findMatches(commits, filter), [commits, filter])` (array of commit indices).
- Reset `matchPos` to 0 whenever `filter` changes (effect on `[filter]`).
- A matched-hash set for O(1) row highlight: `const matchedHashes = useMemo(() => new Set(matches.map((i) => commits[i].hash)), [matches, commits])`.
- Jump helpers:
  - `jumpTo(pos)`: clamp `pos` into `[0, matches.length-1]`; `setMatchPos(pos)`; `const i = matches[pos]`; `onSelect(commits[i])`; `virtuosoRef.current?.scrollIntoView({ index: i, align: "center" })`.
  - `onNext = () => { if (matches.length) jumpTo((matchPos + 1) % matches.length) }`
  - `onPrev = () => { if (matches.length) jumpTo((matchPos - 1 + matches.length) % matches.length) }`
- Render `<RailwaySearch …>` as the FIRST child of `.railway` (above `RailwayHeader`), passing `active`, `matchCount={matches.length}`, `currentMatch={matches.length ? matchPos + 1 : 0}`, `onPrev`, `onNext`, `onClear={() => setFilter({ query: "", author: "" })}`.
- Pass `matched={matchedHashes.has(commit.hash)}` to each `<CommitRow>` in `itemContent`.
- In the existing `onKeyDown`, when the filter is active, make **Enter** = next match and **Shift+Enter** = prev match (only if `matches.length`); otherwise keep the existing ArrowUp/Down/Home/End behavior. (Enter with no active filter does nothing new.)

- [ ] **Step 4: CSS**

In `src/railway/CommitRailway.css` add:
```css
.railway-search {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 10px;
	border-bottom: 1px solid var(--border);
	background: var(--surface);
	flex: none;
}
.railway-search-input {
	flex: 1;
	min-width: 0;
	height: 28px;
	padding: 0 10px;
	border: 1px solid var(--border);
	border-radius: 8px;
	background: var(--bg);
	color: var(--fg);
}
.railway-search-author {
	flex: 0 1 160px;
	min-width: 0;
	height: 28px;
	padding: 0 10px;
	border: 1px solid var(--border);
	border-radius: 8px;
	background: var(--bg);
	color: var(--fg);
}
.railway-search-input:focus,
.railway-search-author:focus {
	outline: none;
	border-color: var(--accent);
	box-shadow: 0 0 0 3px var(--ring);
}
.railway-search-nav {
	flex: none;
	display: flex;
	align-items: center;
	gap: 6px;
}
.railway-search-count {
	color: var(--muted);
	font-size: 12px;
	white-space: nowrap;
}
.commit-row.is-matched {
	background: color-mix(in srgb, #f59e0b 18%, transparent);
}
.commit-row.is-matched.is-selected {
	background: color-mix(in srgb, var(--accent) 22%, transparent);
}
```
(`.railway` is already `display:flex; flex-direction:column`, so the search bar, header, and list stack; the list keeps `flex:1`.)

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: PASS. (`CommitRow.test` updated with `matched={false}`.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: railway search/author filter with highlight and jump"
```

---

### Task 3: Load-until-found for sidebar tip selection

Make a sidebar branch/tag click load more pages until the tip commit is loaded (bounded), so deep tips are reachable.

**Files:**
- Modify: `src/railway/CommitRailway.tsx`

**Interfaces:**
- No prop changes. The `selectHash` effect gains an auto-load loop.

- [ ] **Step 1: Extend the `selectHash` effect**

In `src/railway/CommitRailway.tsx`, the current effect selects+scrolls when `selectHash` is found and clears it; when not found it waits. Change the not-found branch to load more (bounded) so the tip is pulled in:
```tsx
useEffect(() => {
	if (selectHash === null) {
		return
	}
	const i = commits.findIndex((c) => c.hash === selectHash)
	if (i >= 0) {
		onSelect(commits[i])
		virtuosoRef.current?.scrollIntoView({ index: i })
		onSelectHashConsumed()
		return
	}
	// Not loaded yet: pull more pages until it appears (or we hit the end).
	if (!reachedEnd) {
		loadMore()
	} else {
		// Give up: the hash isn't in this ref set; stop pending.
		onSelectHashConsumed()
	}
}, [selectHash, commits, reachedEnd, onSelect, onSelectHashConsumed, loadMore])
```
Requires `reachedEnd` and `loadMore` from `useCommits` (currently `loadMore` is used; expose `reachedEnd` too if not already destructured — check the `useCommits` return and destructure `{ commits, loadMore, reachedEnd, error }`). The `loadingRef`/`genRef` guards inside `useCommits.loadMore` already prevent double-fetch; each appended page re-runs this effect via the `commits` dependency until found or `reachedEnd`. This is naturally bounded by `reachedEnd` (the full ref history), so no manual cap is needed, but note it can load many pages for a very deep tip.

- [ ] **Step 2: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: PASS. The existing `CommitRailway.test.tsx` (selectHash consume test) still passes — it renders with the tip already in `commits`, so the found-branch runs exactly as before. (If that test's `useCommits` mock doesn't return `reachedEnd`, add `reachedEnd: true` to the mock so the not-found path is inert there.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: load more pages until a sidebar-selected tip is found"
```

---

## Self-Review

**Spec coverage (the user's search/filter/focus ask):**
- Message search + author filter → Task 1 (`commitMatches` ANDs subject/hash query with author) + Task 2 (bar) ✓
- Highlight & jump, graph stays intact → Task 2 (rows highlighted via `is-matched`, next/prev scroll+select, no rows removed) ✓
- Load-until-found when a tip is past the loaded commits → Task 3 ✓
- Deferred / not in this plan: server-side deep search (matching only spans loaded commits — "next match" doesn't auto-load beyond what's loaded; acceptable given load-on-scroll + Task 3 for tips). Noted below.

**Placeholder scan:** No TBD/TODO; complete code in each step.

**Type consistency:** `CommitFilter { query, author }` shared across `commitMatch.ts`, `RailwaySearch`, `CommitRailway`. `matched: boolean` added to `CommitRow` props + its test. `findMatches` returns commit indices used consistently for both highlight (via hash set) and jump (via `commits[i]`).

**Known risks / notes:**
1. **Match scope = loaded commits.** Highlight + jump operate over currently-loaded commits; a match deeper than the loaded window isn't counted until the user scrolls it in. This matches "highlight & jump keep the graph." A future enhancement (M-later) could load-until-match like Task 3 does for tips; out of scope here to keep the count stable/predictable.
2. **Enter key** is overloaded to next-match only when the filter is active; when inactive, Arrow/Home/End behavior is unchanged. Confirm the search inputs' own Enter doesn't bubble to the railway keydown in a conflicting way — the inputs are in the search bar (not the focusable `.railway` listbox), so their keydown won't hit the railway's `onKeyDown`; the railway Enter handler only fires when focus is in the list. (If desired later, wire Enter inside the search input to trigger next.)
3. **`matchPos` vs a changing `commits`**: `matches` recomputes when `commits` grows; `matchPos` is an index into `matches` and is reset on filter change. Appending commits can only append matches (order preserved), so `matchPos` stays valid. Fine.
