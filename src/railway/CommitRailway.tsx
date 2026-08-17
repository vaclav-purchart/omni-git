import { Copy } from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import type { CommitSummary } from "../ipc/bindings"
import { buildRefMenu, type RefActions } from "../refs/refMenu"
import { ContextMenu, type MenuItem } from "../ui/ContextMenu"
import { useCommits } from "../workspace/useCommits"
import { CommitRow } from "./CommitRow"
import { type CommitFilter, findMatches, isFilterActive } from "./commitMatch"
import { hashRange, orderedSelection, toggleHash } from "./commitSelection"
import { BRANCH_PALETTE, LANE_WIDTH, ROW_HEIGHT } from "./graphConstants"
import { computeGraph, type GraphInput } from "./graphLayout"
import { RailwayHeader } from "./RailwayHeader"
import { RailwaySearch } from "./RailwaySearch"
import { headBranchName, isHeadCommit, type ParsedRef } from "./refKind"
import { useColumnWidths } from "./useColumnWidths"
import { useWorkingNode } from "./useWorkingNode"
import { WorkingRow } from "./WorkingRow"
import { WORKING_HASH } from "./working"
import "../ui/refBadge.css"
import "./CommitRailway.css"

// Builds the right-click menu for a commit row (SourceTree-inspired). Checkout,
// reword, create-branch, reset, cherry-pick and the clipboard actions are wired;
// the rest is a disabled WIP placeholder scaffolding the write-ops still to come
// (merge, rebase, tag, patch, custom actions).
function buildCommitMenu(
	commit: CommitSummary,
	onCheckoutCommit?: (hash: string) => void,
	onCreateBranch?: (startPoint: string) => void,
	onReset?: (hash: string) => void,
	onReword?: (hash: string, isHead: boolean) => void,
	onCherryPick?: (hashes: string[]) => void,
): MenuItem[] {
	return [
		{
			type: "item",
			label: "Checkout this commit…",
			onClick: () => onCheckoutCommit?.(commit.hash),
		},
		{
			// Grouped with the write-ops rather than near the clipboard items: on
			// anything but HEAD this rewrites history, which is much closer in
			// consequence to a reset than to editing a label.
			type: "item",
			label: "Reword message…",
			onClick: () => onReword?.(commit.hash, isHeadCommit(commit.refs)),
		},
		{ type: "item", label: "Push revision…", wip: true },
		{ type: "item", label: "Merge…", wip: true },
		{ type: "item", label: "Rebase…", wip: true },
		{ type: "item", label: "Rebase children interactively…", wip: true },
		{ type: "separator" },
		{ type: "item", label: "Tag…", wip: true },
		{ type: "item", label: "Sign…", wip: true },
		{ type: "item", label: "Bookmark…", wip: true },
		{ type: "item", label: "Archive…", wip: true },
		{
			type: "item",
			label: "Create branch here…",
			onClick: () => onCreateBranch?.(commit.hash),
		},
		{ type: "separator" },
		{
			type: "item",
			label: "Reset to this commit…",
			danger: true,
			onClick: () => onReset?.(commit.hash),
		},
		{ type: "item", label: "Reverse commit…", wip: true },
		{ type: "item", label: "Create Patch…", wip: true },
		{
			type: "item",
			label: "Cherry Pick…",
			onClick: () => onCherryPick?.([commit.hash]),
		},
		{ type: "separator" },
		{
			type: "item",
			label: "Copy",
			icon: <Copy />,
			onClick: () => {
				navigator.clipboard?.writeText(commit.hash.slice(0, 7)).catch(() => {})
			},
		},
		{
			type: "item",
			label: "Copy SHA-1 to Clipboard",
			onClick: () => {
				navigator.clipboard?.writeText(commit.hash).catch(() => {})
			},
		},
		{ type: "separator" },
		{ type: "item", label: "Custom Actions", wip: true },
	]
}

/**
 * The right-click menu for a SET of commits.
 *
 * Deliberately short. Almost everything in the single-commit menu is defined for
 * exactly one commit — you cannot check out five, or reset to five — so offering
 * those against a selection would either be meaningless or quietly act on one of
 * them. What DOES generalise is here: the clipboard actions, and cherry-picking,
 * which git itself takes as a run of commits in one invocation. The rest (squash,
 * a patch series) needs write support that does not exist yet and is scaffolded
 * as WIP the way the rest of this menu is.
 */
function buildMultiCommitMenu(
	hashes: string[],
	onCherryPick?: (hashes: string[]) => void,
): MenuItem[] {
	const n = hashes.length
	const copy = (text: string) => () => {
		navigator.clipboard?.writeText(text).catch(() => {})
	}
	return [
		{
			type: "item",
			label: `Copy ${n} SHA-1s to Clipboard`,
			icon: <Copy />,
			onClick: copy(hashes.join("\n")),
		},
		{
			type: "item",
			label: `Copy ${n} short SHA-1s to Clipboard`,
			onClick: copy(hashes.map((h) => h.slice(0, 7)).join("\n")),
		},
		{ type: "separator" },
		{
			type: "item",
			label: `Cherry Pick ${n} commits…`,
			onClick: () => onCherryPick?.(hashes),
		},
		{ type: "item", label: `Create Patch from ${n} commits…`, wip: true },
		{ type: "item", label: `Squash ${n} commits…`, wip: true },
	]
}

/**
 * The ref menu for a badge on a commit row, or null when there is nothing to
 * offer.
 *
 * A bare `HEAD` badge (detached) is the only kind that returns null: it names no
 * ref, so none of the branch actions apply. The caller falls back to the commit
 * menu for it — the badge stops the event from reaching the row, so without a
 * fallback that badge would be a patch of row where right-click did nothing.
 *
 * `parseRef` already produces the names git itself uses — `origin/main` for a
 * remote-tracking ref, the bare name for a local branch or tag — which is
 * exactly what the checkout commands expect.
 */
function buildBadgeMenu(
	ref: ParsedRef,
	commit: CommitSummary,
	actions: RefActions,
): MenuItem[] | null {
	if (ref.kind === "head") {
		return null
	}
	return buildRefMenu(
		{ name: ref.label, tip: commit.hash, kind: ref.kind },
		actions,
	)
}

// Measures the width of a classic (non-overlay) scrollbar so the header can
// reserve the same gutter as the Virtuoso scroller (which uses
// `scrollbar-gutter: stable`). Returns 0 on macOS overlay scrollbars (and in
// jsdom), where no inset is needed.
function measureScrollbarWidth(): number {
	const outer = document.createElement("div")
	outer.style.cssText =
		"visibility:hidden;overflow:scroll;position:absolute;width:100px;height:100px;"
	document.body.appendChild(outer)
	const inner = document.createElement("div")
	outer.appendChild(inner)
	const w = outer.offsetWidth - inner.offsetWidth
	outer.remove()
	return w
}

export function CommitRailway({
	repoPath,
	all,
	selectedHash,
	selectHash,
	onSelect,
	onCommitClick,
	onSelectHashConsumed,
	rootRef,
	onAdvance,
	reloadToken = 0,
	onCheckoutCommit,
	onCreateBranch,
	onReset,
	onReword,
	onCherryPick,
	refActions,
}: {
	repoPath: string
	all: boolean
	selectedHash: string | null
	selectHash: string | null
	onSelect: (commit: CommitSummary) => void
	onCommitClick?: (commit: CommitSummary) => void
	onSelectHashConsumed: () => void
	rootRef?: React.RefObject<HTMLDivElement | null>
	onAdvance?: () => void
	// Bumped instead of remounting: a remount threw away the loaded pages, the
	// scroll position and the selection, so every mutation blanked the railway
	// and scrolled back to the top.
	reloadToken?: number
	// Branch operations belong to the workspace (output panel + dialogs live
	// there); the railway only reports which commit was acted on.
	onCheckoutCommit?: (hash: string) => void
	onCreateBranch?: (startPoint: string) => void
	onReset?: (hash: string) => void
	onReword?: (hash: string, isHead: boolean) => void
	// Newest-first, as the log shows them; the backend reverses them into the
	// order the picks have to be applied.
	onCherryPick?: (hashes: string[]) => void
	// Right-clicking a ref badge on a row opens the same menu the sidebar gives
	// that ref, so checking out a branch you can already see doesn't mean going
	// to find it in the sidebar first.
	refActions?: RefActions
}) {
	const { commits, loadMore, reload, reachedEnd, error } = useCommits(
		repoPath,
		all,
		100,
	)
	const { node, counts } = useWorkingNode(repoPath, reloadToken)
	// Re-read in place when something changed the repo. Skips the initial mount,
	// where useCommits is already loading the first page.
	const firstReloadRef = useRef(true)
	useEffect(() => {
		if (firstReloadRef.current) {
			firstReloadRef.current = false
			return
		}
		void reload()
	}, [reloadToken, reload])
	// The synthetic "Uncommitted changes" node is rendered as a pinned row
	// above the list (see `WorkingRow` below); it never enters `commits`, the
	// graph, search, or keyboard nav, and is never a `selectHash` target.
	const workingRow = node && counts ? { node, counts } : null
	const nowMs = useMemo(() => Date.now(), [commits.length])
	// HEAD's sha, so the working node can be parented on it. HEAD is usually NOT
	// the first commit — it's wherever the checked-out tip sorts by date — which
	// is exactly why the working node needs a real graph edge rather than a cue
	// pointing at the row below.
	const headCommit = useMemo(
		() => commits.find((c) => isHeadCommit(c.refs)) ?? null,
		[commits],
	)
	// The working node is injected as row 0 with HEAD as its parent, so
	// computeGraph gives it a genuine lane and carries a passThrough down every
	// row between it and HEAD. Everything indexed off `commits` therefore needs
	// `rowOffset` when talking to the list.
	const rowOffset = workingRow ? 1 : 0
	const graph = useMemo(() => {
		const input: GraphInput[] = commits.map((c) => ({
			hash: c.hash,
			parents: c.parents,
		}))
		if (workingRow) {
			input.unshift({
				hash: WORKING_HASH,
				// No parent when HEAD isn't loaded (or doesn't exist yet on an
				// unborn branch): an isolated node beats an edge to nowhere.
				parents: headCommit ? [headCommit.hash] : [],
				// Dashed all the way down to HEAD: the edge is real, but these
				// changes are not a branch and a solid lane read as one.
				dashed: true,
			})
		}
		return computeGraph(input, BRANCH_PALETTE.length)
	}, [commits, workingRow, headCommit])
	// Constant graph-column width (widest row) so the text column never shifts.
	const graphWidth = useMemo(
		() => Math.max(1, ...graph.map((r) => r.width)) * LANE_WIDTH,
		[graph],
	)
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const { widths, setWidth, persist } = useColumnWidths()
	const [sbw] = useState(measureScrollbarWidth)
	const [filter, setFilter] = useState<CommitFilter>({ query: "", author: "" })
	const [matchPos, setMatchPos] = useState(0)
	const [menu, setMenu] = useState<{
		pos: { x: number; y: number }
		items: MenuItem[]
	} | null>(null)
	const active = isFilterActive(filter)
	const matches = useMemo(() => findMatches(commits, filter), [commits, filter])
	const matchedHashes = useMemo(
		() => new Set(matches.map((i) => commits[i].hash)),
		[matches, commits],
	)

	// The first match for the current query, which is where a search always
	// restarts — refining a query should not leave you reading the fourth hit from
	// the previous one.
	const firstMatchHash = matches.length > 0 ? commits[matches[0]].hash : null

	// Both read through refs so this effect depends on the SEARCH and nothing else.
	//
	// `onSelect` especially: the workspace passes a new inline function on every
	// render, so having it in the dependency array re-ran this effect constantly —
	// and since the guard below only compares against the FIRST match, every
	// attempt to select a different commit was immediately undone. A search made
	// the rest of the log unselectable.
	const selectedHashRef = useRef(selectedHash)
	selectedHashRef.current = selectedHash
	const onSelectRef = useRef(onSelect)
	onSelectRef.current = onSelect

	// What this effect has already acted on. Anything else that re-runs it — a
	// page loading, the working row appearing — finds the search unchanged and
	// leaves the selection alone.
	const appliedRef = useRef<string | null>(null)

	useEffect(() => {
		const signature = `${filter.query}\u0000${filter.author}\u0000${firstMatchHash ?? ""}`
		if (appliedRef.current === signature) {
			return
		}
		appliedRef.current = signature
		setMatchPos(0)
		if (firstMatchHash === null) {
			return
		}
		// Already on it: the query changed but the answer didn't, so leave the view
		// exactly where it is. Scrolling here is the thing that makes a search feel
		// like it is fighting you — every keystroke yanking a row that was already
		// under your eyes back to the centre.
		if (firstMatchHash === selectedHashRef.current) {
			return
		}
		const index = matches[0]
		onSelectRef.current(commits[index])
		// Centred rather than "nearest": a match found while scrolled far away is
		// otherwise dropped against the top or bottom edge with no context around it.
		virtuosoRef.current?.scrollIntoView({
			index: index + rowOffset,
			align: "center",
		})
		// `matches`/`commits` are deliberately absent from the deps: they change
		// identity whenever another page loads, and re-running then would drag the
		// view off whatever the user had scrolled to.
	}, [filter.query, filter.author, firstMatchHash, rowOffset])

	// Sidebar-driven selection: when a ref's tip hash is picked (selectHash
	// changes), select and scroll to that commit if it's loaded, then notify
	// the parent to clear selectHash. Clearing it (rather than leaving it set)
	// prevents a later `commits` reference change (e.g. from loadMore
	// pagination) from re-running this effect and silently reverting a
	// subsequent direct row click back to this hash. If the hash isn't loaded
	// yet, pull more pages until it appears (or we hit the end): each appended
	// page re-runs this effect via the `commits` dependency. This terminates
	// because `reachedEnd` covers the full ref history, and `useCommits`'
	// internal `loadingRef`/`genRef` guards prevent double-fetching a page.
	useEffect(() => {
		if (selectHash === null) {
			return
		}
		// selectHash is always a real commit hash (never WORKING_HASH).
		const i = commits.findIndex((c) => c.hash === selectHash)
		if (i >= 0) {
			onSelect(commits[i])
			virtuosoRef.current?.scrollIntoView({ index: i + rowOffset })
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
	}, [
		selectHash,
		commits,
		reachedEnd,
		onSelect,
		onSelectHashConsumed,
		loadMore,
	])

	// Multi-selection, by hash. Separate from `selectedHash`, which is the ONE
	// commit the detail panel is showing — clicking through a selection to read
	// each commit must not dismantle it.
	const [selectedHashes, setSelectedHashes] = useState<ReadonlySet<string>>(
		new Set(),
	)
	// How far Shift+Arrow has reached; reset whenever the anchor moves. See
	// FileList for why the lead has to be tracked separately from the anchor.
	const [leadHash, setLeadHash] = useState<string | null>(null)
	useEffect(() => {
		setLeadHash(null)
	}, [selectedHash])

	const loadedHashes = useMemo(() => commits.map((c) => c.hash), [commits])
	const multiSelection = orderedSelection(loadedHashes, selectedHashes)
	// One commit selected is just the active row by another name.
	const hasMultiSelection = multiSelection.length > 1

	function selectOnly(commit: CommitSummary) {
		// Seeded rather than cleared: the clicked commit has to be IN the selection
		// for a following Cmd/Ctrl+click to make it two.
		setSelectedHashes(new Set([commit.hash]))
		onSelect(commit)
	}

	function selectIndex(index: number) {
		const clamped = Math.min(commits.length - 1, Math.max(0, index))
		selectOnly(commits[clamped])
		virtuosoRef.current?.scrollIntoView({ index: clamped + rowOffset })
	}

	function extendTo(hash: string) {
		setLeadHash(hash)
		setSelectedHashes(new Set(hashRange(loadedHashes, selectedHash, hash)))
	}

	function move(delta: number, extend = false) {
		if (commits.length === 0) {
			return
		}
		if (extend) {
			const from = leadHash ?? selectedHash
			const cur = from === null ? -1 : loadedHashes.indexOf(from)
			const next = Math.min(
				commits.length - 1,
				Math.max(0, (cur === -1 ? 0 : cur) + delta),
			)
			extendTo(loadedHashes[next])
			virtuosoRef.current?.scrollIntoView({ index: next + rowOffset })
			return
		}
		const current = commits.findIndex((c) => c.hash === selectedHash)
		selectIndex(
			current === -1 ? (delta > 0 ? 0 : commits.length - 1) : current + delta,
		)
	}

	function jumpTo(pos: number) {
		const clamped = Math.min(matches.length - 1, Math.max(0, pos))
		setMatchPos(clamped)
		const i = matches[clamped]
		onSelect(commits[i])
		virtuosoRef.current?.scrollIntoView({
			index: i + rowOffset,
			align: "center",
		})
	}

	function onNext() {
		if (matches.length) {
			jumpTo((matchPos + 1) % matches.length)
		}
	}

	function onPrev() {
		if (matches.length) {
			jumpTo((matchPos - 1 + matches.length) % matches.length)
		}
	}

	function onKeyDown(e: React.KeyboardEvent) {
		// The search/author inputs live inside this keydown-owning container;
		// don't hijack their editing keys (Home/End/Arrows/Enter).
		if ((e.target as HTMLElement).tagName === "INPUT") {
			return
		}
		if (active && matches.length && e.key === "Enter") {
			e.preventDefault()
			if (e.shiftKey) {
				onPrev()
			} else {
				onNext()
			}
			return
		}
		// Cmd/Ctrl+Arrow jumps to the end of the list, the way it does in a text
		// field — checked before the plain arrows, which move by one.
		if (
			(e.metaKey || e.ctrlKey) &&
			(e.key === "ArrowUp" || e.key === "ArrowDown")
		) {
			e.preventDefault()
			selectIndex(e.key === "ArrowUp" ? 0 : commits.length - 1)
			return
		}
		if (e.key === "Enter") {
			e.preventDefault()
			onAdvance?.()
		} else if (e.key === "ArrowDown") {
			e.preventDefault()
			move(1, e.shiftKey)
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			move(-1, e.shiftKey)
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
			ref={rootRef}
			tabIndex={0}
			role="listbox"
			aria-label="Commits"
			onKeyDown={onKeyDown}
			style={
				{
					"--col-graph": `${graphWidth}px`,
					"--col-author": `${widths.author}px`,
					"--col-commit": `${widths.commit}px`,
					"--col-date": `${widths.date}px`,
					"--sbw": `${sbw}px`,
				} as React.CSSProperties
			}
		>
			<RailwaySearch
				filter={filter}
				onFilterChange={setFilter}
				active={active}
				matchCount={matches.length}
				currentMatch={matches.length ? matchPos + 1 : 0}
				onPrev={onPrev}
				onNext={onNext}
				onClear={() => setFilter({ query: "", author: "" })}
			/>
			<RailwayHeader widths={widths} setWidth={setWidth} persist={persist} />
			<div className="railway-list">
				<div className="railway-list-scroll">
					<Virtuoso
						ref={virtuosoRef}
						// Index-based rather than data-based: the working row is row 0 when
						// present, so a row index isn't a `commits` index. It has to live
						// INSIDE the scroller — pinned above it, its lane could not stay
						// connected to commits scrolling underneath.
						totalCount={commits.length + rowOffset}
						fixedItemHeight={ROW_HEIGHT}
						endReached={() => loadMore()}
						itemContent={(index) => {
							if (workingRow && index === 0) {
								return (
									<WorkingRow
										counts={workingRow.counts}
										selected={selectedHash === WORKING_HASH}
										graphRow={graph[0]}
										branch={headCommit ? headBranchName(headCommit.refs) : null}
										headHash={headCommit?.hash ?? null}
										onClick={() => {
											// WebKit (WKWebView) doesn't focus a <button> on click,
											// so focus the panel container ourselves — otherwise the
											// Enter/Arrow/Backspace handlers never fire after a click.
											rootRef?.current?.focus()
											onSelect(workingRow.node)
											onCommitClick?.(workingRow.node)
										}}
									/>
								)
							}
							const commit = commits[index - rowOffset]
							return (
								<CommitRow
									commit={commit}
									graphRow={graph[index]}
									nowMs={nowMs}
									selected={commit.hash === selectedHash}
									inSelection={
										hasMultiSelection && selectedHashes.has(commit.hash)
									}
									matched={matchedHashes.has(commit.hash)}
									onClick={(e) => {
										// See WorkingRow above: focus the container so keyboard
										// nav works after a click (WebKit won't focus the button).
										rootRef?.current?.focus()
										// metaKey on macOS, ctrlKey elsewhere; both accepted on
										// both, since neither means anything else on a row.
										if (e.metaKey || e.ctrlKey) {
											setSelectedHashes((cur) => toggleHash(cur, commit.hash))
											return
										}
										if (e.shiftKey) {
											extendTo(commit.hash)
											return
										}
										selectOnly(commit)
										onCommitClick?.(commit)
									}}
									onContextMenu={(c, e) => {
										e.preventDefault()
										// Right-clicking INSIDE a selection acts on the whole set;
										// on a commit outside it, the selection is not what was
										// aimed at, so that commit's own menu opens.
										const items =
											hasMultiSelection && selectedHashes.has(c.hash)
												? buildMultiCommitMenu(multiSelection, onCherryPick)
												: buildCommitMenu(
														c,
														onCheckoutCommit,
														onCreateBranch,
														onReset,
														onReword,
														onCherryPick,
													)
										setMenu({ pos: { x: e.clientX, y: e.clientY }, items })
									}}
									onRefContextMenu={(ref, c, e) => {
										// A bare `HEAD` badge names no ref, so it has no ref menu.
										// It still has to open SOMETHING: the badge swallows the
										// event to keep the two menus apart, so returning early
										// left a dead patch of row where right-click did nothing.
										const items =
											buildBadgeMenu(ref, c, refActions ?? {}) ??
											buildCommitMenu(
												c,
												onCheckoutCommit,
												onCreateBranch,
												onReset,
												onReword,
												onCherryPick,
											)
										setMenu({ pos: { x: e.clientX, y: e.clientY }, items })
									}}
								/>
							)
						}}
					/>
				</div>
			</div>
			{menu && (
				<ContextMenu
					items={menu.items}
					position={menu.pos}
					onClose={() => setMenu(null)}
				/>
			)}
		</div>
	)
}
