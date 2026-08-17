# Milestone 3b — Full-Branch Graph, Ref Labels & Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the railway show the whole repository DAG — every ref (local + remote branches, tags), all branches and merges — by default, with commits carrying colored ref labels distinguished by kind, and let clicking a branch/tag in the sidebar select + scroll to that ref's tip commit. A toggle narrows the view to the current branch only.

**Architecture:** The commit-loading command gains an `all` flag: `all=true` runs `git log --all --topo-order` (the full DAG feeding the existing graph engine), `all=false` runs the current-branch log. `--decorate=full` makes ref decorations unambiguous so the frontend can classify each ref as local/remote/tag/HEAD and color it. `list_refs` returns each ref's tip commit hash so a sidebar click can select+scroll to it. The Workspace holds a `scope` ("all" | "current") instead of a focused rev. This builds directly on the M3 graph engine (layout + SVG already done). Search/filter (highlight & jump) is the immediate follow-up (M3c), not this plan.

**Tech Stack:** Existing (Tauri 2, Rust, React 18, TS7, react-virtuoso, tauri-specta, Biome, Vitest). No new deps.

## Global Constraints

- **System git only** via the `git::run::run` wrapper (logged to console); never libgit2. Always `git -C <repo> …`.
- **Frontend uses only generated bindings** (`src/ipc/bindings.ts`, git-ignored, generated). **Regenerate headlessly** with `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` — never `npm run tauri dev`. Never hand-edit/commit bindings.
- **New/changed commands** register in the existing `collect_commands![...]` in `specta_builder()`; no second `Builder`; `.events(...)` intact.
- **Generated TS types are snake_case**; `Result`-wrapped commands return `{ status: "ok", data } | { status: "error", error }`; `GitError` is externally-tagged.
- **TS7; Biome 2.5.4 verbatim** (tab indent, double quotes, semicolons asNeeded, trailing commas all). `npm run format` then `npm run lint`; the one info-level biome notice is expected.
- **Graph correctness carries over from M3**: the layout algorithm and `computeGraph` order (commits newest-first, children before parents) must be preserved. `git log --topo-order` guarantees children-before-parents, which the algorithm requires.
- **Theme-aware**; ref-label colors are a small fixed set readable on light+dark.
- **Frequent commits**; never stage `src/ipc/bindings.ts`. Commit author if unset: `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.

## File Structure

- `src-tauri/src/git/log.rs` (modify) — `all` flag; `--all`/`--topo-order`/`--decorate=full`.
- `src-tauri/src/commands/repo_read.rs` (modify) — `log_commits` gains `all: bool`.
- `src-tauri/src/git/refs.rs` (modify) — ref tip hashes.
- `src-tauri/src/commands/repo_refs.rs` (unchanged signature; returns richer types).
- `src/workspace/useCommits.ts` (modify) — `all: boolean` instead of `rev`.
- `src/railway/CommitRailway.tsx` (modify) — `all` prop; scroll-to-selected effect.
- `src/workspace/Workspace.tsx` + `.css` (modify) — `scope` state + toggle; sidebar tip selection.
- `src/railway/refKind.ts` + `.test.ts` (new) — classify full refnames.
- `src/railway/CommitRow.tsx` + `src/railway/CommitRailway.css` (modify) — colored ref chips by kind.
- `src/sidebar/Sidebar.tsx` (modify) — pass tip hash on click; highlight by selected tip.
- `src/sidebar/useRepoRefs.ts` (unchanged) — types flow through.
- `src/workspace/useCommits.test.ts`, `src/App.test.tsx`, `src/sidebar/Sidebar.test.tsx` (modify) — signatures/mocks.

---

### Task 1: `log_commits` all-refs mode + full decoration (backend)

**Files:**
- Modify: `src-tauri/src/git/log.rs`, `src-tauri/src/commands/repo_read.rs`

**Interfaces:**
- Changed: `pub fn log_commits(app, repo_path, all: bool, skip, limit) -> Result<Vec<CommitSummary>, GitError>` — `all=true` → `git log --all --topo-order --decorate=full …`; `all=false` → `git log --topo-order --decorate=full …` (current HEAD). The `rev: Option<&str>` parameter is REMOVED.
- Changed command: `log_commits(repo_path: String, all: bool, skip: u32, limit: u32)` → generated `commands.logCommits(repoPath, all, skip, limit)`.
- `CommitSummary.refs` now contains **full** refnames (e.g. `HEAD -> refs/heads/main`, `refs/remotes/origin/main`, `tag: refs/tags/v1`), parsed the same way (split on `, `).

- [ ] **Step 1: Update `log_commits` and its parser expectations**

In `src-tauri/src/git/log.rs`, change the signature and args:
```rust
pub fn log_commits(
	app: &tauri::AppHandle,
	repo_path: &str,
	all: bool,
	skip: u32,
	limit: u32,
) -> Result<Vec<CommitSummary>, GitError> {
	let format_arg = format!("--pretty=format:{}", FORMAT);
	let skip_arg = format!("--skip={}", skip);
	let max_arg = format!("--max-count={}", limit);
	let mut args: Vec<&str> = vec![
		"log",
		"--topo-order",
		"--decorate=full",
		&format_arg,
		&skip_arg,
		&max_arg,
	];
	if all {
		args.push("--all");
	}
	let stdout = run(app, repo_path, &args)?;
	Ok(parse_log(&stdout))
}
```
Keep `FORMAT`, `parse_line`, `parse_log` unchanged — refs are still split on `, ` (now full refnames). The existing parser tests still pass (they use synthetic refs; add one full-refname case in Step 2).

- [ ] **Step 2: Add a parser test for full refnames**

In the `tests` module of `log.rs`, add:
```rust
#[test]
fn parses_full_decorated_refs() {
	let rec = "h\u{1f}p\u{1f}A\u{1f}a@x\u{1f}1700000000\u{1f}HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1\u{1f}subj\u{1e}";
	let c = &parse_log(rec)[0];
	assert_eq!(
		c.refs,
		vec![
			"HEAD -> refs/heads/main",
			"refs/remotes/origin/main",
			"tag: refs/tags/v1",
		]
	);
}
```

- [ ] **Step 3: Update the command wrapper**

In `src-tauri/src/commands/repo_read.rs`:
```rust
#[tauri::command]
#[specta::specta]
pub fn log_commits(
	app: tauri::AppHandle,
	repo_path: String,
	all: bool,
	skip: u32,
	limit: u32,
) -> Result<Vec<CommitSummary>, GitError> {
	gl(&app, &repo_path, all, skip, limit)
}
```

- [ ] **Step 4: Build, test, regenerate bindings**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::log && cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings`
Expected: log tests pass (incl. the new one); `commands.logCommits(repoPath, all, skip, limit)` with `all: boolean` in bindings.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: log_commits all-refs mode with full ref decoration"
```

---

### Task 2: Frontend scope wiring (all vs current)

Thread the `all` flag through the hook, railway, and workspace; replace the focused-rev pill with an All/Current scope toggle.

**Files:**
- Modify: `src/workspace/useCommits.ts`, `src/workspace/useCommits.test.ts`, `src/railway/CommitRailway.tsx`, `src/workspace/Workspace.tsx`, `src/workspace/Workspace.css`, `src/App.test.tsx`

**Interfaces:**
- Changed: `useCommits(repoPath: string, all: boolean, pageSize: number)` — passes `all` to `commands.logCommits`; resets on `all` change.
- Changed: `<CommitRailway repoPath all={boolean} selectedHash onSelect />` (prop `rev` → `all`).
- Workspace: `scope: "all" | "current"` state (default `"all"`); toggle button; removes `rev`.

- [ ] **Step 1: Update `useCommits`**

In `src/workspace/useCommits.ts`, replace the `rev: string | null` param with `all: boolean`, pass it to `commands.logCommits(repoPath, all, skipRef.current, pageSize)`, and use `all` in the reset effect deps and the `loadMore` deps. Preserve the `genRef` + `loadingRef` guards exactly. (Mechanical rename of the second parameter + the call argument + the two dependency arrays.)

- [ ] **Step 2: Update `useCommits.test.ts`**

Change every `useCommits("A", null, 50)` / `useCommits("B", null, 50)` to `useCommits("A", true, 50)` / `useCommits("B", true, 50)`; if the `commands.logCommits` mock asserts args, update to `(repoPath, true, skip, limit)`. Keep the asserted behavior identical.

- [ ] **Step 3: Update `CommitRailway`**

Rename the `rev: string | null` prop to `all: boolean` and pass it to `useCommits(repoPath, all, 100)`. Everything else (graph, keyboard nav, graphWidth) unchanged.

- [ ] **Step 4: Update `Workspace` — scope state + toggle**

In `src/workspace/Workspace.tsx`:
- Replace `const [rev, setRev] = useState<string | null>(null)` with `const [scope, setScope] = useState<"all" | "current">("all")`.
- Replace the `.workspace-ref` pill button with a scope toggle:
```tsx
<button
	type="button"
	className="workspace-scope"
	title={scope === "all" ? "Showing all branches — click to focus current branch" : "Showing current branch — click to show all branches"}
	onClick={() => {
		setScope((s) => (s === "all" ? "current" : "all"))
		setSelected(null)
		setDiff("")
		setDiffPath(null)
	}}
>
	{scope === "all" ? "All branches" : "Current branch"}
</button>
```
- Pass `all={scope === "all"}` to `<CommitRailway>` and update its `key` to `` `${scope}:${refreshKey}` ``.
- The Sidebar `onSelectRef` is reworked in Task 4; for now, keep passing `activeRef`/`onSelectRef` but they will change. To keep this task compiling, temporarily pass `activeRef={null}` and `onSelectRef={() => {}}` (Task 4 wires the tip-selection). Leave a `// TODO(Task 4)` comment.

- [ ] **Step 5: Update `Workspace.css`**

Rename `.workspace-ref` styles to `.workspace-scope` (same pill look; keep the accent-tinted rounded style, remove the `:disabled` rule since the toggle is always active). Keep everything else.

- [ ] **Step 6: Update `App.test.tsx` mock**

`logCommits` is now called as `(repoPath, all, skip, limit)`; the existing mock returns `{ status: "ok", data: [] }` regardless of args, so no change is strictly required — but verify the mock signature still matches (it ignores args). No assertion changes.

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run build`
Expected: PASS. (Manual GUI check later will show the multi-lane graph — this is the task that switches the data source to `--all`.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: show all branches by default with a current-branch scope toggle"
```

---

### Task 3: Ref-kind classification + colored chips

Classify full refnames and render ref chips colored by kind on commits.

**Files:**
- Create: `src/railway/refKind.ts`, `src/railway/refKind.test.ts`
- Modify: `src/railway/CommitRow.tsx`, `src/railway/CommitRailway.css`

**Interfaces:**
- Produces: `type RefKind = "head" | "local" | "remote" | "tag"`; `parseRef(decoration: string): { kind: RefKind; label: string; isHead: boolean }` — parses one `%D` entry (full-decorated).
  - `"HEAD -> refs/heads/main"` → `{ kind: "local", label: "main", isHead: true }`
  - `"refs/heads/feature/x"` → `{ kind: "local", label: "feature/x", isHead: false }`
  - `"refs/remotes/origin/main"` → `{ kind: "remote", label: "origin/main", isHead: false }`
  - `"tag: refs/tags/v1"` → `{ kind: "tag", label: "v1", isHead: false }`
  - bare `"HEAD"` (detached) → `{ kind: "head", label: "HEAD", isHead: true }`

- [ ] **Step 1: Write the failing test**

Create `src/railway/refKind.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { parseRef } from "./refKind"

describe("parseRef", () => {
	it("classifies a checked-out local branch", () => {
		expect(parseRef("HEAD -> refs/heads/main")).toEqual({
			kind: "local",
			label: "main",
			isHead: true,
		})
	})
	it("classifies a local branch with slashes", () => {
		expect(parseRef("refs/heads/feature/x")).toEqual({
			kind: "local",
			label: "feature/x",
			isHead: false,
		})
	})
	it("classifies a remote branch", () => {
		expect(parseRef("refs/remotes/origin/main")).toEqual({
			kind: "remote",
			label: "origin/main",
			isHead: false,
		})
	})
	it("classifies a tag", () => {
		expect(parseRef("tag: refs/tags/v1")).toEqual({
			kind: "tag",
			label: "v1",
			isHead: false,
		})
	})
	it("handles detached HEAD", () => {
		expect(parseRef("HEAD")).toEqual({
			kind: "head",
			label: "HEAD",
			isHead: true,
		})
	})
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/railway/refKind.test.ts`
Expected: FAIL — cannot find `./refKind`.

- [ ] **Step 3: Implement**

Create `src/railway/refKind.ts`:
```ts
export type RefKind = "head" | "local" | "remote" | "tag"
export type ParsedRef = { kind: RefKind; label: string; isHead: boolean }

export function parseRef(decoration: string): ParsedRef {
	let isHead = false
	let ref = decoration.trim()
	if (ref.startsWith("HEAD -> ")) {
		isHead = true
		ref = ref.slice("HEAD -> ".length)
	}
	if (ref === "HEAD") {
		return { kind: "head", label: "HEAD", isHead: true }
	}
	if (ref.startsWith("tag: ")) {
		const full = ref.slice("tag: ".length)
		return { kind: "tag", label: full.replace(/^refs\/tags\//, ""), isHead }
	}
	if (ref.startsWith("refs/remotes/")) {
		return { kind: "remote", label: ref.slice("refs/remotes/".length), isHead }
	}
	if (ref.startsWith("refs/heads/")) {
		return { kind: "local", label: ref.slice("refs/heads/".length), isHead }
	}
	return { kind: "local", label: ref, isHead }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/railway/refKind.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Render colored chips in `CommitRow`**

In `src/railway/CommitRow.tsx`, replace the `refLabel`-based chip rendering with `parseRef`:
```tsx
import { parseRef } from "./refKind"
// remove the old refLabel helper
// …in the JSX where refs were mapped:
{commit.refs.map((r) => {
	const parsed = parseRef(r)
	return (
		<span
			key={r}
			className={`commit-ref ref-${parsed.kind} ${parsed.isHead ? "is-head" : ""}`}
			title={r}
		>
			{parsed.label}
		</span>
	)
})}
```

- [ ] **Step 6: Add chip colors in `CommitRailway.css`**

Replace the single `.commit-ref` rule with kind-specific colors (readable on light+dark; use fixed hex tints):
```css
.commit-ref {
	flex: none;
	font-size: 11px;
	padding: 1px 6px;
	border-radius: 999px;
	border: 1px solid transparent;
	white-space: nowrap;
	max-width: 180px;
	overflow: hidden;
	text-overflow: ellipsis;
}
.commit-ref.ref-local {
	background: color-mix(in srgb, #3b82f6 20%, transparent);
	color: #3b82f6;
	border-color: color-mix(in srgb, #3b82f6 35%, transparent);
}
.commit-ref.ref-remote {
	background: color-mix(in srgb, #f59e0b 20%, transparent);
	color: #f59e0b;
	border-color: color-mix(in srgb, #f59e0b 35%, transparent);
}
.commit-ref.ref-tag {
	background: color-mix(in srgb, #22c55e 20%, transparent);
	color: #22c55e;
	border-color: color-mix(in srgb, #22c55e 35%, transparent);
}
.commit-ref.ref-head {
	background: color-mix(in srgb, #a855f7 20%, transparent);
	color: #a855f7;
}
.commit-ref.is-head {
	font-weight: 700;
}
```
Keep the existing `.commit-row-main` gap so chips sit before the subject.

- [ ] **Step 7: Verify + commit**

Run: `npx vitest run && npm run build && npm run lint`
Expected: PASS.
```bash
git add -A
git commit -m "feat: classify and color ref labels (local/remote/tag/HEAD)"
```

---

### Task 4: Ref tip hashes + sidebar-to-tip navigation

`list_refs` returns each ref's tip commit hash; the sidebar selects + scrolls to that commit instead of reloading.

**Files:**
- Modify: `src-tauri/src/git/refs.rs` (tip hashes)
- Modify: `src/sidebar/Sidebar.tsx`, `src/sidebar/Sidebar.test.tsx`
- Modify: `src/railway/CommitRailway.tsx` (scroll-to-selected effect)
- Modify: `src/workspace/Workspace.tsx` (wire sidebar → select by hash)

**Interfaces:**
- Changed Rust types: `LocalBranch { name, is_head, upstream, tip: String }`, `RemoteBranch { name, remote, tip: String }`, and tags become `pub struct TagRef { pub name: String, pub tip: String }` with `RepoRefs.tags: Vec<TagRef>`.
- Changed Sidebar prop: `onSelectRef: (tipHash: string) => void`; `activeHash: string | null` (highlight the ref whose tip === activeHash).
- CommitRailway gains no new prop but adds an effect: when `selectedHash` changes and is present in `commits`, `scrollIntoView` to it.

- [ ] **Step 1: Add tip hashes to `list_refs` (Rust)**

In `src-tauri/src/git/refs.rs`, extend the for-each-ref formats to include `%(objectname)` (and for tags, deref with `%(*objectname)` for annotated tags), and parse into the new `tip` fields. Update `LocalBranch`, `RemoteBranch`, add `TagRef { name, tip }`, and `RepoRefs.tags: Vec<TagRef>`. For locals/remotes the format becomes `%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(objectname)` (locals) and `%(refname:short)%1f%(objectname)` (remotes); for tags `%(refname:short)%1f%(objectname)%1f%(*objectname)` and `tip = deref if non-empty else objectname`. Update `parse_locals`/`parse_remotes`/`parse_tags` and their unit tests accordingly (add a field to the fixture strings and assert the tip).

- [ ] **Step 2: Build + regenerate bindings**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::refs && cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`
Expected: refs tests pass; bindings now include `tip` on `LocalBranch`/`RemoteBranch` and a `TagRef` type. `npm run build` will FAIL where `Sidebar.tsx` consumes tags as strings — fixed in Step 3.

- [ ] **Step 3: Sidebar selects the tip (frontend)**

In `src/sidebar/Sidebar.tsx`:
- Change the prop to `onSelectRef: (tipHash: string) => void` and add `activeHash: string | null`.
- Local/remote/tag rows call `onSelectRef(<tip hash>)`; tags now map over `TagRef` (`t.name`, `t.tip`).
- Highlight (`is-current`) a row when its tip hash === `activeHash` (instead of the old name-based `active`).
Update `src/sidebar/Sidebar.test.tsx`: the `useRepoRefs` mock's refs gain `tip` fields (e.g. `{ name: "main", is_head: true, upstream: "origin/main", tip: "hMain" }`, tags `[{ name: "v1.0", tip: "hV1" }]`); pass `activeHash={null}`; the click test asserts `onSelectRef` is called with the tip hash (`"hMain"` etc.). Keep the "lists branches/tags/current" assertions (current highlight now keys on `activeHash`, so adjust that assertion to click-and-expect-tip or drop the is-current check if it no longer applies without an activeHash — assert the row renders instead).

- [ ] **Step 4: Scroll-to-selected effect in `CommitRailway`**

Add an effect so selecting a commit (from the sidebar) scrolls it into view:
```tsx
useEffect(() => {
	if (selectedHash === null) {
		return
	}
	const i = commits.findIndex((c) => c.hash === selectedHash)
	if (i >= 0) {
		virtuosoRef.current?.scrollIntoView({ index: i })
	}
}, [selectedHash, commits])
```
(Import `useEffect`. If the tip isn't in the loaded window it's a no-op — acceptable; note as a limitation.)

- [ ] **Step 5: Wire Workspace sidebar → select-by-hash**

In `src/workspace/Workspace.tsx`, replace the Task-2 placeholder:
```tsx
<Sidebar
	key={refreshKey}
	repoPath={repo.path}
	activeHash={selected?.hash ?? null}
	onSelectRef={(tipHash) => {
		setSelected({ hash: tipHash } as CommitSummary)
	}}
/>
```
Wait — `setSelected` needs a full `CommitSummary` for `CommitDetail`. Instead, select by hash: change `selected` handling so the railway drives selection. Simpler and correct: keep `selected: CommitSummary | null`; on sidebar click, find the commit in the railway. Since Workspace doesn't hold the commit list, pass a callback down OR store a `pendingHash`. Cleanest: lift a `selectedHash: string | null` state in Workspace, pass it to both `CommitRailway` (`selectedHash`) and derive `selected` via the railway. But `CommitDetail` needs the `CommitSummary` (for `.hash` + `.subject`). It only uses `selectedCommit.hash` and `.subject`. 

Resolution for this task: hold `selectedHash: string | null` in Workspace (instead of `selected: CommitSummary`). `CommitRailway` takes `selectedHash` + `onSelect(commit)`; when the user clicks a row, `onSelect` sets `selectedHash = commit.hash` AND stashes the commit for the detail. Keep a `selectedCommit: CommitSummary | null` too, updated by `onSelect`. The sidebar sets `selectedHash` (by tip); a new railway effect, when `selectedHash` matches a loaded commit, calls `onSelect(thatCommit)` so `selectedCommit` (and scroll) update. Implement:
- Workspace state: `selectedHash: string | null`, `selectedCommit: CommitSummary | null`.
- `onSelect={(c) => { setSelectedHash(c.hash); setSelectedCommit(c) }}` passed to railway.
- Sidebar `onSelectRef={(tip) => setSelectedHash(tip)}`.
- CommitRailway: the scroll-to-selected effect (Step 4) ALSO, when it finds the commit for `selectedHash` and it differs from what the parent has, calls `onSelect(commit)` to sync the detail. To avoid loops, only call when the found commit's hash isn't already the "committed" selection — pass `selectedHash` and compare. Concretely, in the effect: `const c = commits.find(...); if (c) { virtuoso scroll; onSelect(c) }` — but `onSelect` sets selectedHash to the same value (idempotent) and selectedCommit; guard by checking the effect only runs on `selectedHash` change. Since `onSelect(c)` sets selectedHash to c.hash (unchanged) it won't re-trigger the effect (same value). Safe.

Pass `selectedCommit` to `CommitDetail`.

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run build && cargo build --manifest-path src-tauri/Cargo.toml && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: ref tip hashes; sidebar selects and scrolls to a ref's tip"
```

---

## Self-Review

**Spec coverage (this slice of the user's request):**
- See everything in the loaded history — all branches, origin + local, tags → Task 1 (`--all`) + Task 3 (labels) ✓
- Distinguishable ref labels (local/remote/tag/HEAD colored) → Task 3 ✓
- Focus just the current branch → Task 2 scope toggle ✓
- Clicking a branch/tag selects its tip commit in the view → Task 4 ✓
- Deferred to M3c (next): message search + author filter with highlight & jump. ✓

**Placeholder scan:** Task 2 Step 4 deliberately stubs the Sidebar props with a `// TODO(Task 4)` to keep each task compiling; Task 4 removes it. No other placeholders.

**Type consistency:** `log_commits(repoPath, all, skip, limit)` updated in Rust, command, `useCommits`, its test, `CommitRailway`, `App.test`. `CommitSummary.refs` = full refnames consumed by `parseRef`. `LocalBranch`/`RemoteBranch`/`TagRef` `tip` fields flow Rust → bindings → `useRepoRefs` → `Sidebar`. `RefKind` union consistent between `refKind.ts` and the CSS class names (`ref-local`/`ref-remote`/`ref-tag`/`ref-head`).

**Known risks flagged for execution:**
1. **Order requirement**: the graph algorithm needs children-before-parents; `--topo-order` guarantees it. Do NOT switch to a mode that could violate it without re-checking the algorithm.
2. **Signature ripple** (`rev` → `all`): Task 2 touches the hook, its test, the railway, and Workspace together; keep the `genRef`/`loadingRef` guards intact.
3. **Selection refactor** (Task 4 Step 5): moving from `selected: CommitSummary` to `selectedHash` + `selectedCommit` must avoid an effect loop — the sync `onSelect(c)` sets `selectedHash` to the same value, so the `[selectedHash]` effect won't re-fire. Verify no loop (mirror the M2a CommitDetail loop lesson: don't depend on unstable callbacks).
4. **Tip not in loaded window**: clicking a ref whose tip is beyond the loaded commits is a no-op scroll; acceptable for now (note for M3c: load-until-found).
5. **Annotated tags**: tip uses `%(*objectname)` deref; lightweight tags use `%(objectname)`. A tag pointing at a non-commit is an edge case.
