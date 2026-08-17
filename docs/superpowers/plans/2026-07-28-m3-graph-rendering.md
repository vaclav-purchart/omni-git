# Milestone 3 — Graph Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the commit "railway" — colored branch lanes connecting commits (nodes + edges), rendered as SVG aligned row-for-row with the virtualized commit list, with distinct branch colors and lanes kept as straight as possible.

**Architecture:** A pure TypeScript layout function turns the ordered `(hash, parents)` commit list into per-row graph data (node column/color, incoming/outgoing/pass-through edge segments). A small SVG component renders one row's graph cell at a fixed row height; the commit railway computes the layout (memoized over the loaded commits) and prepends a graph cell to each row so it stays aligned inside react-virtuoso. This is milestone 3 of v1; it produces the visible graph on its own. Also folds in the deferred merge-commit fix so merge commits list their changed files.

**Tech Stack:** Existing (Tauri 2, Rust, React 18, TS7, react-virtuoso, tauri-specta, Biome, Vitest). No new dependencies (hand-rolled SVG).

## Design decision (flagged for the reviewer/human)

The graph layout is computed in **TypeScript**, not Rust as the spec's prose suggested. Rationale: the layout is a pure function of the ordered `(hash, parents)` list, the frontend already holds the accumulated paginated commits (`useCommits`), and computing client-side avoids threading cross-page lane state through IPC on every "load more." It preserves the spec's actual intent (we compute topology ourselves; we never parse git's ASCII art). Performance note: the layout is recomputed over the loaded commits on each page append (O(n) per append); fine for the loaded window, revisit only if it becomes hot.

## Global Constraints

Apply to **every** task.

- **System git only** — any git interaction shells out via the existing `git::run::run` wrapper (logged to the console). Never libgit2/a git library; always `git -C <repo_path> …`.
- **Frontend never touches git/fs directly** — only generated bindings from `src/ipc/bindings.ts` (git-ignored, generated).
- **Regenerate bindings HEADLESSLY** with `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` — never `npm run tauri dev` (no display). Never hand-edit/commit `src/ipc/bindings.ts`.
- **New commands register by ADDING to the existing `collect_commands![...]`** in `specta_builder()` (`src-tauri/src/lib.rs`); do not create a second `Builder`; leave `.events(...)` intact.
- **Generated TS types are snake_case**; `Result`-wrapped commands return `{ status: "ok", data } | { status: "error", error }`.
- **TypeScript 7; Biome 2.5.4 verbatim** (tab indent, double quotes, semicolons `asNeeded`, trailing commas `all`). `npm run format` then `npm run lint` before committing; the one pre-existing info-level biome notice is expected.
- **Theme-aware** — the app chrome uses theme tokens; the branch palette is a fixed set chosen to read on BOTH light and dark (mid-tone saturated colors), defined once and reused.
- **Row alignment is load-bearing** — the commit row height must be a fixed constant shared between the graph SVG and the row layout, or edges won't line up. Define it once and import it.
- **Frequent commits**; never stage `src/ipc/bindings.ts`. Commit author if unset: `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.

## File Structure

- `src/railway/graphLayout.ts` (new) — pure layout algorithm + types.
- `src/railway/graphLayout.test.ts` (new) — algorithm unit tests.
- `src/railway/graphConstants.ts` (new) — `ROW_HEIGHT`, `LANE_WIDTH`, `BRANCH_PALETTE`.
- `src/railway/CommitGraph.tsx` (new) — SVG cell for one row.
- `src/railway/CommitGraph.test.tsx` (new).
- `src/railway/CommitRow.tsx` (modify) — accept + render a graph cell; fixed height.
- `src/railway/CommitRow.test.tsx` (modify) — pass a graph row.
- `src/railway/CommitRailway.tsx` (modify) — compute layout, fixed-height rows, pass graph rows.
- `src/railway/CommitRailway.css` (modify) — fixed row height, graph cell layout.
- `src-tauri/src/git/changes.rs` (modify) — merge-commit files fix.

---

### Task 1: Graph layout algorithm (pure, TDD)

The core: turn the ordered commit list into per-row graph data. Commits arrive newest-first (as `git log` returns them); a commit's children are above (already placed), its parents below.

**Files:**
- Create: `src/railway/graphLayout.ts`, `src/railway/graphLayout.test.ts`

**Interfaces:**
- Produces:
  - `type GraphInput = { hash: string; parents: string[] }`
  - `type EdgeIn = { fromCol: number; color: number }` — a line from the top edge (fromCol) to the node.
  - `type EdgeOut = { toCol: number; color: number }` — a line from the node to the bottom edge (toCol).
  - `type PassLine = { col: number; color: number }` — a straight line crossing the row at `col`.
  - `type GraphRow = { col: number; color: number; width: number; incoming: EdgeIn[]; outgoing: EdgeOut[]; passThrough: PassLine[] }`
  - `computeGraph(commits: GraphInput[], paletteSize: number): GraphRow[]`

- [ ] **Step 1: Write the failing tests**

Create `src/railway/graphLayout.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { computeGraph } from "./graphLayout"

const P = 8

describe("computeGraph", () => {
	it("lays a linear history in a single lane", () => {
		const rows = computeGraph(
			[
				{ hash: "c", parents: ["b"] },
				{ hash: "b", parents: ["a"] },
				{ hash: "a", parents: [] },
			],
			P,
		)
		expect(rows.map((r) => r.col)).toEqual([0, 0, 0])
		// same color down the mainline
		expect(new Set(rows.map((r) => r.color)).size).toBe(1)
		// each non-root has one straight outgoing edge in its own lane
		expect(rows[0].outgoing).toEqual([{ toCol: 0, color: rows[0].color }])
		expect(rows[2].outgoing).toEqual([]) // root has no parents
		expect(rows[0].incoming).toEqual([]) // tip has no children above
	})

	it("opens a second lane for a branch and frees it after a merge", () => {
		// m(merge of a,b) -> a, b ; a->base ; b->base ; base
		const rows = computeGraph(
			[
				{ hash: "m", parents: ["a", "b"] },
				{ hash: "a", parents: ["base"] },
				{ hash: "b", parents: ["base"] },
				{ hash: "base", parents: [] },
			],
			P,
		)
		// merge node in lane 0, with two outgoing edges (to a in lane 0, b in lane 1)
		expect(rows[0].col).toBe(0)
		expect(rows[0].outgoing.map((e) => e.toCol).sort()).toEqual([0, 1])
		// a stays lane 0, b is lane 1
		expect(rows[1].col).toBe(0)
		expect(rows[2].col).toBe(1)
		// base collects both a and b: two incoming edges converging to its node
		expect(rows[3].incoming.map((e) => e.fromCol).sort()).toEqual([0, 1])
		expect(rows[3].outgoing).toEqual([]) // base is a root
	})

	it("keeps a pass-through line for an unrelated lane spanning a row", () => {
		// tip1 (lane0) -> p1 ; tip2 (lane1) -> p2 ; p1 ; p2
		// Between tip2's row and below, lane 0 (waiting for p1) passes through.
		const rows = computeGraph(
			[
				{ hash: "t1", parents: ["p1"] },
				{ hash: "t2", parents: ["p2"] },
				{ hash: "p1", parents: [] },
				{ hash: "p2", parents: [] },
			],
			P,
		)
		expect(rows[0].col).toBe(0)
		expect(rows[1].col).toBe(1)
		// t2's row: lane 0 (open, waiting for p1) is a pass-through at col 0
		expect(rows[1].passThrough.some((l) => l.col === 0)).toBe(true)
		// p1 lands in lane 0, p2 in lane 1
		expect(rows[2].col).toBe(0)
		expect(rows[3].col).toBe(1)
	})

	it("reuses a freed lane rather than growing width", () => {
		const rows = computeGraph(
			[
				{ hash: "m", parents: ["a", "b"] },
				{ hash: "a", parents: ["c"] },
				{ hash: "b", parents: ["c"] }, // merges back into c
				{ hash: "c", parents: ["d"] },
				{ hash: "d", parents: [] },
			],
			P,
		)
		// After c, lane 1 is freed; width should not exceed 2 anywhere.
		expect(Math.max(...rows.map((r) => r.width))).toBeLessThanOrEqual(2)
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/railway/graphLayout.test.ts`
Expected: FAIL — cannot find `./graphLayout`.

- [ ] **Step 3: Implement**

Create `src/railway/graphLayout.ts`:
```ts
export type GraphInput = { hash: string; parents: string[] }
export type EdgeIn = { fromCol: number; color: number }
export type EdgeOut = { toCol: number; color: number }
export type PassLine = { col: number; color: number }
export type GraphRow = {
	col: number
	color: number
	width: number
	incoming: EdgeIn[]
	outgoing: EdgeOut[]
	passThrough: PassLine[]
}

function firstFree(lanes: (string | null)[]): number {
	const i = lanes.indexOf(null)
	return i === -1 ? lanes.length : i
}

/**
 * Assigns each commit a lane (column) and computes the edge segments crossing
 * its row. Commits are newest-first (git log order): a commit's children are
 * already placed (above), its parents come below.
 *
 * `lanes[c]` holds the hash a column is currently waiting to draw (an open edge
 * to a not-yet-seen commit), or null when free. Merges free the extra lanes so
 * later branches reuse them, keeping the graph narrow and lanes straight.
 */
export function computeGraph(
	commits: GraphInput[],
	paletteSize: number,
): GraphRow[] {
	const lanes: (string | null)[] = []
	const laneColor: number[] = []
	let nextColor = 0
	const newColor = () => {
		const c = nextColor % paletteSize
		nextColor++
		return c
	}
	const rows: GraphRow[] = []

	for (const commit of commits) {
		const top = lanes.slice()
		const topColor = laneColor.slice()

		const incomingCols: number[] = []
		for (let c = 0; c < top.length; c++) {
			if (top[c] === commit.hash) {
				incomingCols.push(c)
			}
		}

		let col: number
		let color: number
		if (incomingCols.length > 0) {
			col = incomingCols[0]
			color = topColor[col]
		} else {
			col = firstFree(lanes)
			color = newColor()
		}

		// Build the bottom state: clear every lane that ends at this node, then
		// place the parents.
		const bottom = top.slice()
		const bottomColor = topColor.slice()
		for (const c of incomingCols) {
			bottom[c] = null
		}
		bottom[col] = null // node lane is (re)assigned below if it has a first parent

		const outgoing: EdgeOut[] = []
		commit.parents.forEach((parent, i) => {
			if (i === 0) {
				bottom[col] = parent
				bottomColor[col] = color
				outgoing.push({ toCol: col, color })
			} else {
				// Merge into a lane already waiting for this parent, else open one.
				let target = bottom.indexOf(parent)
				if (target === -1) {
					target = firstFree(bottom)
					bottomColor[target] = newColor()
				}
				bottom[target] = parent
				outgoing.push({ toCol: target, color: bottomColor[target] })
			}
		})

		const incoming: EdgeIn[] = incomingCols.map((c) => ({
			fromCol: c,
			color: topColor[c],
		}))

		const width = Math.max(top.length, bottom.length, col + 1)
		const passThrough: PassLine[] = []
		for (let c = 0; c < width; c++) {
			if (c !== col && top[c] != null && bottom[c] === top[c]) {
				passThrough.push({ col: c, color: topColor[c] })
			}
		}

		rows.push({ col, color, width, incoming, outgoing, passThrough })

		// Commit bottom state back into the working lanes, trimming trailing nulls.
		lanes.length = 0
		laneColor.length = 0
		for (let c = 0; c < bottom.length; c++) {
			lanes[c] = bottom[c]
			laneColor[c] = bottomColor[c]
		}
		while (lanes.length > 0 && lanes[lanes.length - 1] == null) {
			lanes.pop()
			laneColor.pop()
		}
	}

	return rows
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/railway/graphLayout.test.ts`
Expected: PASS (4). If a case fails, fix the algorithm (this is the crux — get it right before rendering).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pure commit-graph lane layout algorithm"
```

---

### Task 2: Graph constants + `CommitGraph` SVG cell

Render one row's `GraphRow` as an SVG: node circle, incoming (top→node) and outgoing (node→bottom) curved edges, and straight pass-through lines. Fixed row height so it aligns with the list.

**Files:**
- Create: `src/railway/graphConstants.ts`, `src/railway/CommitGraph.tsx`, `src/railway/CommitGraph.test.tsx`

**Interfaces:**
- Consumes: `GraphRow` (Task 1).
- Produces:
  - `graphConstants`: `export const ROW_HEIGHT = 40`, `export const LANE_WIDTH = 14`, `export const BRANCH_PALETTE: string[]` (8 mid-tone colors readable on light+dark).
  - `<CommitGraph row={GraphRow} />` — an SVG of width `row.width * LANE_WIDTH` and height `ROW_HEIGHT`.

- [ ] **Step 1: Write the failing test**

Create `src/railway/CommitGraph.test.tsx`:
```tsx
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CommitGraph } from "./CommitGraph"

describe("CommitGraph", () => {
	it("renders a node circle and an edge for a simple row", () => {
		const { container } = render(
			<CommitGraph
				row={{
					col: 0,
					color: 0,
					width: 1,
					incoming: [],
					outgoing: [{ toCol: 0, color: 0 }],
					passThrough: [],
				}}
			/>,
		)
		expect(container.querySelector("circle")).toBeTruthy()
		expect(container.querySelectorAll("path").length).toBe(1) // one outgoing edge
	})

	it("draws a line per pass-through lane", () => {
		const { container } = render(
			<CommitGraph
				row={{
					col: 1,
					color: 1,
					width: 2,
					incoming: [],
					outgoing: [],
					passThrough: [{ col: 0, color: 3 }],
				}}
			/>,
		)
		// one pass-through path + node has no edges here
		expect(container.querySelectorAll("path").length).toBe(1)
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/railway/CommitGraph.test.tsx`
Expected: FAIL — cannot find `./CommitGraph`.

- [ ] **Step 3: Implement constants and component**

Create `src/railway/graphConstants.ts`:
```ts
export const ROW_HEIGHT = 40
export const LANE_WIDTH = 14

// Mid-tone, reasonably distinct, readable on both light and dark backgrounds.
export const BRANCH_PALETTE = [
	"#3b82f6",
	"#22c55e",
	"#f59e0b",
	"#ef4444",
	"#a855f7",
	"#06b6d4",
	"#ec4899",
	"#84cc16",
]

export function laneColor(index: number): string {
	return BRANCH_PALETTE[index % BRANCH_PALETTE.length]
}
```
Create `src/railway/CommitGraph.tsx`:
```tsx
import type { GraphRow } from "./graphLayout"
import { LANE_WIDTH, ROW_HEIGHT, laneColor } from "./graphConstants"

function cx(col: number): number {
	return col * LANE_WIDTH + LANE_WIDTH / 2
}

export function CommitGraph({ row }: { row: GraphRow }) {
	const width = Math.max(1, row.width) * LANE_WIDTH
	const nodeX = cx(row.col)
	const midY = ROW_HEIGHT / 2

	return (
		<svg
			className="commit-graph"
			width={width}
			height={ROW_HEIGHT}
			viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
			aria-hidden="true"
		>
			{/* Pass-through lanes: straight top→bottom */}
			{row.passThrough.map((l) => (
				<path
					key={`p${l.col}`}
					d={`M ${cx(l.col)} 0 L ${cx(l.col)} ${ROW_HEIGHT}`}
					stroke={laneColor(l.color)}
					strokeWidth="2"
					fill="none"
				/>
			))}
			{/* Incoming: top edge (fromCol) → node (curved) */}
			{row.incoming.map((e) => (
				<path
					key={`i${e.fromCol}`}
					d={`M ${cx(e.fromCol)} 0 C ${cx(e.fromCol)} ${midY / 2}, ${nodeX} ${midY / 2}, ${nodeX} ${midY}`}
					stroke={laneColor(e.color)}
					strokeWidth="2"
					fill="none"
				/>
			))}
			{/* Outgoing: node → bottom edge (toCol) (curved) */}
			{row.outgoing.map((e) => (
				<path
					key={`o${e.toCol}`}
					d={`M ${nodeX} ${midY} C ${nodeX} ${midY + midY / 2}, ${cx(e.toCol)} ${midY + midY / 2}, ${cx(e.toCol)} ${ROW_HEIGHT}`}
					stroke={laneColor(e.color)}
					strokeWidth="2"
					fill="none"
				/>
			))}
			<circle cx={nodeX} cy={midY} r="4" fill={laneColor(row.color)} />
		</svg>
	)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/railway/CommitGraph.test.tsx`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: SVG commit-graph cell and branch palette"
```

---

### Task 3: Integrate the graph into the railway

Compute the layout in the railway (memoized), render a fixed-height row with the graph cell prepended, keeping everything aligned inside react-virtuoso.

**Files:**
- Modify: `src/railway/CommitRow.tsx`, `src/railway/CommitRow.test.tsx`, `src/railway/CommitRailway.tsx`, `src/railway/CommitRailway.css`

**Interfaces:**
- Consumes: `computeGraph` (Task 1), `CommitGraph` + `graphConstants` (Task 2).
- Changed: `<CommitRow commit graphRow={GraphRow} nowMs selected onClick />` — renders `<CommitGraph row={graphRow} />` before the existing content, at fixed height `ROW_HEIGHT`.

- [ ] **Step 1: Update `CommitRow` and its test**

In `src/railway/CommitRow.tsx`, add a `graphRow: GraphRow` prop and render the graph cell first:
```tsx
import type { CommitSummary } from "../ipc/bindings"
import { formatRelative } from "../time"
import { CommitGraph } from "./CommitGraph"
import type { GraphRow } from "./graphLayout"

function refLabel(ref: string): string {
	return ref.replace(/^HEAD -> /, "").replace(/^tag: /, "")
}

export function CommitRow({
	commit,
	graphRow,
	nowMs,
	selected,
	onClick,
}: {
	commit: CommitSummary
	graphRow: GraphRow
	nowMs: number
	selected: boolean
	onClick: () => void
}) {
	return (
		<button
			type="button"
			className={`commit-row ${selected ? "is-selected" : ""}`}
			onClick={onClick}
		>
			<div className="commit-graph-cell">
				<CommitGraph row={graphRow} />
			</div>
			<div className="commit-row-main">
				{commit.refs.map((r) => (
					<span key={r} className="commit-ref" title={r}>
						{refLabel(r)}
					</span>
				))}
				<span className="commit-subject" title={commit.subject}>
					{commit.subject}
				</span>
			</div>
			<div className="commit-row-meta">
				<span
					className="commit-author"
					title={`${commit.author_name} <${commit.author_email}>`}
				>
					{commit.author_name}
				</span>
				<span className="commit-hash" title={commit.hash}>
					{commit.hash.slice(0, 7)}
				</span>
				<span className="commit-date">
					{formatRelative(commit.timestamp_ms, nowMs)}
				</span>
			</div>
		</button>
	)
}
```
In `src/railway/CommitRow.test.tsx`, pass a minimal `graphRow` to both render calls, e.g.:
```tsx
const graphRow = {
	col: 0,
	color: 0,
	width: 1,
	incoming: [],
	outgoing: [],
	passThrough: [],
}
```
Add `graphRow={graphRow}` to each `<CommitRow …/>` in the test. Keep all existing assertions (subject, author, short hash, ref labels, onClick) unchanged.

- [ ] **Step 2: Run the CommitRow test**

Run: `npx vitest run src/railway/CommitRow.test.tsx`
Expected: PASS (existing assertions still hold with the graph cell added).

- [ ] **Step 3: Wire layout into `CommitRailway`**

In `src/railway/CommitRailway.tsx`: compute the graph over the loaded commits (memoized), fix the row height, and pass each row its `graphRow`:
```tsx
import { useMemo, useRef } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import type { CommitSummary } from "../ipc/bindings"
import { useCommits } from "../workspace/useCommits"
import { CommitRow } from "./CommitRow"
import { computeGraph } from "./graphLayout"
import { BRANCH_PALETTE, ROW_HEIGHT } from "./graphConstants"
import "./CommitRailway.css"

export function CommitRailway({
	repoPath,
	rev,
	selectedHash,
	onSelect,
}: {
	repoPath: string
	rev: string | null
	selectedHash: string | null
	onSelect: (commit: CommitSummary) => void
}) {
	const { commits, loadMore, error } = useCommits(repoPath, rev, 100)
	const nowMs = useMemo(() => Date.now(), [commits.length])
	const graph = useMemo(
		() =>
			computeGraph(
				commits.map((c) => ({ hash: c.hash, parents: c.parents })),
				BRANCH_PALETTE.length,
			),
		[commits],
	)
	const virtuosoRef = useRef<VirtuosoHandle>(null)

	function selectIndex(index: number) {
		const clamped = Math.min(commits.length - 1, Math.max(0, index))
		onSelect(commits[clamped])
		virtuosoRef.current?.scrollIntoView({ index: clamped })
	}
	function move(delta: number) {
		if (commits.length === 0) {
			return
		}
		const current = commits.findIndex((c) => c.hash === selectedHash)
		selectIndex(
			current === -1 ? (delta > 0 ? 0 : commits.length - 1) : current + delta,
		)
	}
	function onKeyDown(e: React.KeyboardEvent) {
		if (e.key === "ArrowDown") {
			e.preventDefault()
			move(1)
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			move(-1)
		} else if (e.key === "Home") {
			e.preventDefault()
			selectIndex(0)
		} else if (e.key === "End") {
			e.preventDefault()
			selectIndex(commits.length - 1)
		}
	}

	if (error !== null) {
		return <div className="railway-error">{error}</div>
	}
	return (
		<div
			className="railway"
			tabIndex={0}
			role="listbox"
			aria-label="Commits"
			onKeyDown={onKeyDown}
		>
			<Virtuoso
				ref={virtuosoRef}
				data={commits}
				fixedItemHeight={ROW_HEIGHT}
				endReached={() => loadMore()}
				itemContent={(index, commit) => (
					<CommitRow
						commit={commit}
						graphRow={graph[index]}
						nowMs={nowMs}
						selected={commit.hash === selectedHash}
						onClick={() => onSelect(commit)}
					/>
				)}
			/>
		</div>
	)
}
```
Note: `graph[index]` aligns with `data={commits}` because `computeGraph` returns one row per commit in the same order. `fixedItemHeight={ROW_HEIGHT}` keeps virtuoso rows exactly the graph height.

- [ ] **Step 4: Update `CommitRailway.css`**

Give the row a fixed height and lay out the graph cell:
```css
.commit-row {
	width: 100%;
	height: 40px; /* must equal ROW_HEIGHT in graphConstants.ts */
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 0 12px;
	background: none;
	border: none;
	border-bottom: 1px solid var(--border);
	text-align: left;
}
.commit-graph-cell {
	flex: none;
	display: flex;
	align-items: stretch;
	align-self: stretch;
}
```
(Keep the existing `.commit-row:hover`, `.is-selected`, `.commit-row-main`, `.commit-subject`, `.commit-ref`, `.commit-row-meta`, `.commit-hash` rules; only the `.commit-row` box + the new `.commit-graph-cell` change. Remove the old vertical padding from `.commit-row` since height is now fixed.)

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run build`
Expected: PASS. The full suite includes the graph tests and the updated CommitRow test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: render the commit graph in the railway"
```

---

### Task 4: Fix merge-commit changed-files (folded-in deferral)

Merge commits currently show an empty file list because `commit_files` runs `diff-tree --root` without `-m`/`--cc`. Show the first-parent diff for merges so the list is populated.

**Files:**
- Modify: `src-tauri/src/git/changes.rs`

**Interfaces:**
- Unchanged signature: `commit_files(app, repo_path, hash) -> Result<Vec<FileChange>, GitError>`; behavior now also lists files for merge commits.

- [ ] **Step 1: Add a test asserting `-m --first-parent` is used, and dedupe**

In `src-tauri/src/git/changes.rs`, update `commit_files` to pass `-m --first-parent` so merges diff against their first parent, and dedupe paths (with `-m`, `diff-tree` can repeat a path across parents; keep the first occurrence). Add a unit test for the dedupe:
```rust
// in the existing tests module
#[test]
fn dedupes_repeated_paths_from_m_output() {
	// With -m, diff-tree can emit the same path once per parent.
	let z = "M\u{0}same.rs\u{0}M\u{0}same.rs\u{0}A\u{0}new.rs\u{0}";
	let out = super::dedupe_by_path(super::parse_name_status(z));
	assert_eq!(out.len(), 2);
	assert_eq!(out[0].path, "same.rs");
	assert_eq!(out[1].path, "new.rs");
}
```

- [ ] **Step 2: Implement**

Add a `dedupe_by_path` helper and use it in `commit_files`:
```rust
pub fn dedupe_by_path(changes: Vec<FileChange>) -> Vec<FileChange> {
	let mut seen = std::collections::HashSet::new();
	changes
		.into_iter()
		.filter(|c| seen.insert(c.path.clone()))
		.collect()
}

pub fn commit_files(
	app: &tauri::AppHandle,
	repo_path: &str,
	hash: &str,
) -> Result<Vec<FileChange>, GitError> {
	// `-m --first-parent` makes merge commits list their (first-parent) diff
	// instead of nothing; `--root` handles the initial commit.
	let z = run(
		app,
		repo_path,
		&[
			"diff-tree",
			"--no-commit-id",
			"--name-status",
			"-r",
			"-z",
			"-m",
			"--first-parent",
			"--root",
			hash,
		],
	)?;
	Ok(dedupe_by_path(parse_name_status(&z)))
}
```

- [ ] **Step 3: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::changes`
Expected: existing parse tests + the new dedupe test PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: merge commits list first-parent changed files"
```

---

## Self-Review

**Spec coverage (M3 slice):**
- Straight branches where possible → Task 1 (lanes reused, not compacted mid-branch; first parent keeps the node's lane/color) ✓
- Distinguished by color → Task 2 palette, per-lane colors ✓
- Graph aligned with the commit list, virtualized → Task 3 (`fixedItemHeight`, one `graphRow` per commit, shared `ROW_HEIGHT`) ✓
- One branch and multiple branches navigable → the existing railway + sidebar rev selection still drive it; the graph reflects whatever `rev`/history is loaded ✓
- Computed by us, not git's ASCII → Task 1 (from structured parents) ✓ (in TS, not Rust — flagged in the Design decision section)
- Merge-commit changed files → Task 4 ✓
- Deferred and NOT in this plan: author/message filtering (fractures the graph; its own slice later); FS-watch live refresh (M2c). ✓

**Placeholder scan:** No TBD/TODO; complete code in every step.

**Type consistency:** `GraphRow`/`EdgeIn`/`EdgeOut`/`PassLine` used identically across `graphLayout.ts`, `CommitGraph.tsx`, `CommitRow.tsx`, and the railway. `ROW_HEIGHT` is the single source of truth shared between `graphConstants.ts`, the CSS (commented to match), and virtuoso's `fixedItemHeight`. `computeGraph` order matches `commits` order so `graph[index]` aligns.

**Known risks flagged for execution:**
1. **Row alignment**: `.commit-row` height in CSS must equal `ROW_HEIGHT` (40). If a later change alters row height, edges misalign — the CSS carries a comment pointing at `graphConstants.ts`.
2. **`graph[index]` vs `commits[index]`**: they must stay index-aligned; both derive from the same `commits` array in the same order. If filtering is added later, this coupling must be revisited.
3. **Layout recompute cost**: O(n) per page append; fine for the loaded window, noted for later optimization if it becomes hot.
4. **Octopus merges (>2 parents)**: handled (each extra parent opens/merges a lane), but rare; the SVG will show 3+ outgoing edges — visually busy but correct.
