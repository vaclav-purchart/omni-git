# Milestone 5.2 — Fork-Base Perf + Test-File Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Fix the multi-second "Compare with base" delay by making `fork_base` rank only a small curated candidate set instead of every branch. (2) De-emphasize test/spec files in the changed-files lists (dimmed) with a "Hide tests" toggle, in both the commit view and the PR-compare view.

**Architecture:** `fork_base` swaps its "all branches" candidate source for a curated list (`default_branch` + main/master/develop + their `origin/` forms), so it runs ~7 (not ~170) `merge-base`/`rev-list` pairs. A pure `isTestFile` classifier + a shared `ChangedFilesList` component (dim + hide-tests toggle + keyboard nav) replaces the duplicated file-list markup in `CommitDetail` and `CompareDetail` (their load/guard logic stays). Builds on merged M5.1.

**Tech Stack:** Existing. No new deps.

## Global Constraints

- System git only via `git::run::run`; frontend uses only generated bindings (no bindings change expected here — `fork_base` signature is unchanged).
- Preserve the loop-safe load pattern in `CommitDetail`/`CompareDetail` (`onFileDiff` in a ref; load effect deps exclude it; genRef/reqRef guards) and their keyboard-nav behavior.
- TS7; Biome verbatim; theme-aware; frequent commits; author if unset `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.

## File Structure

- `src-tauri/src/git/compare.rs` (modify) — curated candidate list in `fork_base`.
- `src/detail/fileClass.ts` + `.test.ts` (new) — `isTestFile`.
- `src/detail/ChangedFilesList.tsx` (new) — shared list (dim + hide-tests toggle + keyboard nav).
- `src/detail/CommitDetail.tsx`, `src/detail/CompareDetail.tsx` (modify) — use `ChangedFilesList`.
- `src/detail/CommitDetail.css` (modify) — dim + toggle styles.

---

### Task 1: Fork-base perf — curated candidate set

**Files:**
- Modify: `src-tauri/src/git/compare.rs`

**Interfaces:**
- Unchanged signature `fork_base(app, repo_path, head) -> Option<String>`; internally ranks only a curated candidate set.

- [ ] **Step 1: Replace the candidate source**

In `src-tauri/src/git/compare.rs`, `fork_base` currently iterates `branch_names(app, repo_path)` (all local + remote refs). Replace that with a curated candidate list and keep the same ranking (`merge-base` + `rev-list --count mb..head` → `pick_fork_base`). Add:
```rust
/// Small set of branches a feature is realistically forked from — the default
/// branch plus common mainline names (local + origin). Keeps fork_base to a
/// handful of git calls instead of one per branch (was multi-second on repos
/// with many branches).
fn base_candidates(app: &tauri::AppHandle, repo_path: &str, head: &str) -> Vec<String> {
	let mut cands: Vec<String> = Vec::new();
	if let Some(d) = default_branch(app, repo_path) {
		cands.push(d);
	}
	for name in [
		"main",
		"master",
		"develop",
		"origin/main",
		"origin/master",
		"origin/develop",
	] {
		cands.push(name.to_string());
	}
	cands.sort();
	cands.dedup();
	cands.retain(|c| c != head);
	cands
}
```
Change `fork_base` to iterate `base_candidates(app, repo_path, head)` instead of `branch_names(...)`. Non-existent candidates make `merge-base` exit non-zero → already skipped via the `Err(_) => continue`. Keep `pick_fork_base` and its unit tests unchanged. `branch_names` may become unused — if so, delete it (don't leave dead code; it's no longer needed).

- [ ] **Step 2: Verify**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::compare` (pick_fork_base tests still pass) and `cargo build --manifest-path src-tauri/Cargo.toml` (no dead-code warnings — remove `branch_names` if unused). `npm run lint` (no TS changed).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "perf: fork_base ranks a curated base set (not every branch)"
```

---

### Task 2: `isTestFile` classifier (pure, TDD)

**Files:**
- Create: `src/detail/fileClass.ts`, `src/detail/fileClass.test.ts`

**Interfaces:**
- Produces: `isTestFile(path: string): boolean` — true when the filename contains `.test.` or `.spec.` (case-insensitive), e.g. `foo.test.ts`, `Bar.spec.tsx`, `a/b/x.test.js`. False for `foo.ts`, `contest.ts` (no dotted `.test.`), `spec/readme.md`.

- [ ] **Step 1: Failing test**

Create `src/detail/fileClass.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { isTestFile } from "./fileClass"

describe("isTestFile", () => {
	it("matches .test. and .spec. in the filename", () => {
		expect(isTestFile("src/foo.test.ts")).toBe(true)
		expect(isTestFile("src/Bar.spec.tsx")).toBe(true)
		expect(isTestFile("a/b/x.test.js")).toBe(true)
		expect(isTestFile("pkg/y.SPEC.ts")).toBe(true)
	})
	it("does not match non-test files", () => {
		expect(isTestFile("src/foo.ts")).toBe(false)
		expect(isTestFile("src/contest.ts")).toBe(false)
		expect(isTestFile("spec/readme.md")).toBe(false)
		expect(isTestFile("test/helpers.ts")).toBe(false)
	})
})
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/detail/fileClass.test.ts` → FAIL (missing module).

- [ ] **Step 3: Implement**

Create `src/detail/fileClass.ts`:
```ts
// A changed file is "test-ish" (lower review priority) when its FILENAME
// contains a dotted .test. or .spec. segment — matches foo.test.ts,
// Bar.spec.tsx; not directories named test/ or files like contest.ts.
export function isTestFile(path: string): boolean {
	const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
	return name.includes(".test.") || name.includes(".spec.")
}
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run src/detail/fileClass.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: isTestFile classifier for changed-files"
```

---

### Task 3: Shared `ChangedFilesList` (dim + hide-tests toggle + keyboard nav) and adopt it

Extract the changed-files list (currently duplicated in `CommitDetail` and `CompareDetail`) into one component that dims test files, offers a "Hide tests" toggle, and owns the arrow-key navigation — then use it in both.

**Files:**
- Create: `src/detail/ChangedFilesList.tsx`
- Modify: `src/detail/CommitDetail.tsx`, `src/detail/CompareDetail.tsx`, `src/detail/CommitDetail.css`

**Interfaces:**
- Produces: `<ChangedFilesList subject={ReactNode} files={FileChange[]} activePath={string | null} onOpen={(path: string) => void} />` — renders a header row (`subject` + a "Hide tests" toggle shown only when the list contains test files), then the file list. Test files get an `is-test` dim class; when "Hide tests" is on they're filtered out. Owns `tabIndex`/`role="listbox"`/`onKeyDown` (Arrow/Home/End over the *visible* files) + scroll-active-into-view. Calls `onOpen(path)` on click and on keyboard move.
- Consumes: `isTestFile` (Task 2), `MiddlePath`, `FileChange`.

- [ ] **Step 1: Implement `ChangedFilesList`**

Create `src/detail/ChangedFilesList.tsx`:
```tsx
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import type { FileChange } from "../ipc/bindings"
import { MiddlePath } from "../ui/MiddlePath"
import { isTestFile } from "./fileClass"

export function ChangedFilesList({
	subject,
	files,
	activePath,
	onOpen,
}: {
	subject: ReactNode
	files: FileChange[]
	activePath: string | null
	onOpen: (path: string) => void
}) {
	const [hideTests, setHideTests] = useState(false)
	const activeRef = useRef<HTMLButtonElement>(null)

	const testCount = useMemo(
		() => files.filter((f) => isTestFile(f.path)).length,
		[files],
	)
	const visible = useMemo(
		() => (hideTests ? files.filter((f) => !isTestFile(f.path)) : files),
		[files, hideTests],
	)

	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" })
	}, [activePath])

	function move(delta: number) {
		if (visible.length === 0) {
			return
		}
		const cur = visible.findIndex((f) => f.path === activePath)
		const next =
			cur === -1
				? delta > 0
					? 0
					: visible.length - 1
				: Math.min(visible.length - 1, Math.max(0, cur + delta))
		onOpen(visible[next].path)
	}

	function onKeyDown(e: React.KeyboardEvent) {
		if (e.key === "ArrowDown") {
			e.preventDefault()
			move(1)
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			move(-1)
		}
	}

	return (
		<div
			className="detail"
			tabIndex={0}
			role="listbox"
			aria-label="Changed files"
			onKeyDown={onKeyDown}
		>
			<div className="detail-subject-row">
				<div className="detail-subject">{subject}</div>
				{testCount > 0 && (
					<button
						type="button"
						className={`detail-hide-tests ${hideTests ? "is-on" : ""}`}
						title="Hide .test./.spec. files"
						onClick={() => setHideTests((h) => !h)}
					>
						{hideTests ? `Show tests (${testCount})` : `Hide tests (${testCount})`}
					</button>
				)}
			</div>
			<ul className="detail-files">
				{visible.map((f) => (
					<li key={f.path}>
						<button
							type="button"
							ref={activePath === f.path ? activeRef : undefined}
							className={`detail-file ${activePath === f.path ? "is-active" : ""} ${isTestFile(f.path) ? "is-test" : ""}`}
							onClick={() => onOpen(f.path)}
						>
							<span className={`detail-status s-${f.status[0]}`} title={f.status}>
								{f.status}
							</span>
							<MiddlePath path={f.path} className="detail-path" />
						</button>
					</li>
				))}
			</ul>
		</div>
	)
}
```

- [ ] **Step 2: Use it in `CommitDetail`**

In `src/detail/CommitDetail.tsx`, keep all the load/`openFile`/genRef/reqRef/onFileDiffRef/error/empty logic, but replace the returned `<div className="detail">…files…</div>` markup (and remove the now-unneeded local `activeRef`/`moveFile`/`onKeyDown`/keyboard effect that move into `ChangedFilesList`) with:
```tsx
return (
	<ChangedFilesList
		subject={selectedCommit.subject}
		files={files}
		activePath={activePath}
		onOpen={openFile}
	/>
)
```
Keep the `selectedCommit === null` empty-state return above it. Import `ChangedFilesList`; drop the `MiddlePath` import if now unused here.

- [ ] **Step 3: Use it in `CompareDetail`**

Same in `src/detail/CompareDetail.tsx`: keep load/openFile/guards/error/empty; replace the file-list markup (and remove its local keyboard-nav bits) with:
```tsx
return (
	<ChangedFilesList
		subject={`${head} ← ${base}`}
		files={files}
		activePath={activePath}
		onOpen={openFile}
	/>
)
```
Keep the error and empty-state returns above it. Import `ChangedFilesList`; drop `MiddlePath` if now unused.

- [ ] **Step 4: CSS**

In `src/detail/CommitDetail.css` add:
```css
.detail-subject-row {
	display: flex;
	align-items: center;
	gap: 8px;
	border-bottom: 1px solid var(--border);
}
.detail-subject-row .detail-subject {
	flex: 1;
	min-width: 0;
	border-bottom: none;
}
.detail-hide-tests {
	flex: none;
	margin-right: 8px;
	padding: 2px 8px;
	border: 1px solid var(--border);
	border-radius: 999px;
	background: none;
	color: var(--muted);
	font-size: 11px;
	white-space: nowrap;
}
.detail-hide-tests:hover {
	background: var(--surface-hover);
}
.detail-hide-tests.is-on {
	color: var(--accent);
	border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}
.detail-file.is-test {
	opacity: 0.55;
}
.detail-file.is-test.is-active {
	opacity: 1;
}
```
(The existing `.detail-subject` rule keeps its padding; the new `.detail-subject-row .detail-subject` override drops its own border since the row provides it. Verify no double border.)

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: PASS. The existing `CommitDetail.test.tsx` (file names render, click loads diff, arrow-key nav, stale-race) still passes — it renders `CommitDetail`, which now renders `ChangedFilesList` with the same `role="listbox"`/`aria-label="Changed files"`, file buttons, and `onOpen`→`openFile` wiring, so the DOM/behavior the test asserts is unchanged. (If the keyboard-nav test targeted `moveFile` internals, it should target the rendered listbox + file text, which still holds.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: dim + hide test/spec files in changed-files lists (shared ChangedFilesList)"
```

---

## Self-Review

**Spec coverage:**
- Fork-base perf → Task 1 (curated ~7 candidates vs ~170) ✓
- Distinguish/de-emphasize test & spec files → Task 3 (`is-test` dim) ✓
- Toggle to hide them → Task 3 ("Hide tests (N)" toggle, shown only when tests present) ✓, in both commit + PR views (shared component) ✓
- "or something more generic" → kept to `.test.`/`.spec.` for now (clear + matches the ask); a generic glob filter is a possible later extension (noted).

**Placeholder scan:** none.

**Type consistency:** `isTestFile(path)` used in `ChangedFilesList`; `ChangedFilesList` props consistent with both `CommitDetail`/`CompareDetail` usages (`subject` node, `files`, `activePath`, `onOpen`). Both detail components retain their loop-safe load + `openFile` and just delegate rendering.

**Known risks:**
1. **Fork-base curated set** may miss a fork from a non-mainline branch (e.g. feature-off-feature) → falls back to the default branch; user can pick the real base via the searchable dropdown. Acceptable and fast. Deliberately EXCLUDES the branch's own upstream (which would wrongly win the nearest-merge-base ranking).
2. **Keyboard nav over visible files**: when "Hide tests" is on, arrows traverse only visible files; if the active file was a test file that just got hidden, the next arrow starts from "not found" → first/last. Minor, acceptable.
3. **Refactor risk**: `CommitDetail`/`CompareDetail` load/guard logic must be preserved; only the render + local keyboard-nav move into `ChangedFilesList`. The existing CommitDetail tests guard the behavior.
