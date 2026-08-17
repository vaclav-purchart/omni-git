import {
	Cloud,
	GitBranch,
	MagnifyingGlass,
	Stack,
	Tag,
	TreeStructure,
	X,
} from "@phosphor-icons/react"
import { useState } from "react"
import type { RemoteBranch, RepoRefs, Stash, Worktree } from "../ipc/bindings"
import { buildRefMenu, type Ref } from "../refs/refMenu"
import { ContextMenu, type MenuItem } from "../ui/ContextMenu"
import { NO_AUTOCORRECT } from "../ui/textInput"
import { filterNames } from "./refFilter"
import { SidebarSection } from "./SidebarSection"
import "./Sidebar.css"

function groupByRemote(remotes: RemoteBranch[]): Map<string, RemoteBranch[]> {
	const map = new Map<string, RemoteBranch[]>()
	for (const rb of remotes) {
		const list = map.get(rb.remote) ?? []
		list.push(rb)
		map.set(rb.remote, list)
	}
	return map
}

export function Sidebar({
	refs,
	worktrees,
	stashes,
	error,
	activeHash,
	onSelectRef,
	onDiffRef,
	onSelectStash,
	onApplyStash,
	onPopStash,
	activeStash = null,
	onCheckout,
	onCreateBranch,
	onDeleteRef,
}: {
	// Passed in rather than fetched here: the workspace already holds a
	// useRepoRefs instance for the compare head/base, and a second one meant every
	// startup and every refresh ran the three ref commands TWICE.
	refs: RepoRefs | null
	worktrees: Worktree[]
	stashes: Stash[]
	error: string | null
	activeHash: string | null
	onSelectRef: (ref: Ref) => void
	onDiffRef?: (ref: Ref) => void
	// A stash is browsable like a commit: its files and patches open in the detail
	// panel, which is where apply/pop are offered too.
	onSelectStash?: (stash: Stash) => void
	onApplyStash?: (stash: Stash) => void
	onPopStash?: (stash: Stash) => void
	/** Selector of the stash currently being previewed, if any. */
	activeStash?: string | null
	// Branch operations run in the workspace, which owns the output panel and the
	// dialogs; the sidebar only says which ref was acted on.
	onCheckout?: (ref: Ref) => void
	onCreateBranch?: (startPoint: string) => void
	onDeleteRef?: (ref: Ref, force: boolean) => void
}) {
	const [menu, setMenu] = useState<{
		pos: { x: number; y: number }
		items: MenuItem[]
	} | null>(null)
	// Not persisted: a filter left over from the last session would hide branches
	// with no clue as to why.
	const [query, setQuery] = useState("")

	function openBranchMenu(ref: Ref, e: React.MouseEvent) {
		e.preventDefault()
		setMenu({
			pos: { x: e.clientX, y: e.clientY },
			// Shared with the ref badges on commit rows, so right-clicking `main`
			// offers the same actions wherever you happen to find it.
			items: buildRefMenu(ref, {
				onCheckout,
				onCreateBranch,
				onDiffRef,
				onDeleteRef,
			}),
		})
	}

	if (error !== null && refs === null) {
		return <div className="sidebar sidebar-error">{error}</div>
	}
	if (refs === null) {
		return <div className="sidebar sidebar-loading">Loading…</div>
	}
	// Filtered per list rather than over one flat set, so a match keeps the section
	// it belongs to — knowing whether `main` is the local branch or the remote one
	// is most of the answer.
	const localBranches = filterNames(refs.local, (b) => b.name, query)
	const tags = filterNames(refs.tags, (t) => t.name, query)
	const filteredWorktrees = filterNames(
		worktrees,
		(w) => w.branch ?? w.path,
		query,
	)
	const filteredStashes = filterNames(stashes, (st) => st.message, query)
	const remoteGroups = [...groupByRemote(refs.remotes).entries()]
		.map(
			([remote, branches]) =>
				[remote, filterNames(branches, (b) => b.name, query)] as const,
		)
		// A remote with nothing left is dropped entirely while filtering — an empty
		// "origin" heading is noise when you are looking for one branch.
		.filter(([, branches]) => query.trim() === "" || branches.length > 0)
	const searching = query.trim() !== ""
	const matchCount =
		localBranches.length +
		tags.length +
		filteredWorktrees.length +
		filteredStashes.length +
		remoteGroups.reduce((n, [, branches]) => n + branches.length, 0)

	const refButton = (
		name: string,
		tip: string,
		kind: "local" | "remote" | "tag",
	) => (
		<button
			type="button"
			className={`sidebar-ref ${tip === activeHash ? "is-active" : ""}`}
			title={name}
			onClick={() => onSelectRef({ name, tip, kind })}
			onContextMenu={(e) => openBranchMenu({ name, tip, kind }, e)}
		>
			{name}
		</button>
	)

	return (
		<div className="sidebar">
			<div className="sidebar-search">
				<MagnifyingGlass className="sidebar-search-icon" aria-hidden="true" />
				<input
					{...NO_AUTOCORRECT}
					className="sidebar-search-input"
					aria-label="Filter branches and tags"
					placeholder="Filter branches, tags…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						// Escape clears rather than closing anything: the field is always
						// there, and a stale filter is the thing worth getting rid of.
						if (e.key === "Escape" && query !== "") {
							e.preventDefault()
							e.stopPropagation()
							setQuery("")
						}
					}}
				/>
				{searching && (
					<button
						type="button"
						className="sidebar-search-clear"
						aria-label="Clear filter"
						title="Clear filter"
						onClick={() => setQuery("")}
					>
						<X />
					</button>
				)}
			</div>
			{searching && matchCount === 0 && (
				<div className="sidebar-empty">Nothing matches “{query.trim()}”.</div>
			)}
			<SidebarSection
				title="Local"
				count={localBranches.length}
				icon={<GitBranch />}
			>
				{localBranches.map((b) => (
					<div key={b.name} className="sidebar-row">
						<button
							type="button"
							className={`sidebar-ref ${b.tip === activeHash ? "is-active" : ""} ${
								b.is_head ? "is-checked-out" : ""
							}`}
							// The dot alone is aria-hidden, so without this the
							// checked-out branch had no accessible marker at all.
							aria-current={b.is_head ? "true" : undefined}
							title={`${b.upstream ? `${b.name} → ${b.upstream}` : b.name}${
								b.is_head ? " (checked out)" : ""
							}`}
							onClick={() =>
								onSelectRef({ name: b.name, tip: b.tip, kind: "local" })
							}
							onContextMenu={(e) =>
								openBranchMenu({ name: b.name, tip: b.tip, kind: "local" }, e)
							}
						>
							{b.is_head && (
								<span className="sidebar-head-dot" aria-hidden="true" />
							)}
							<span className="sidebar-ref-name">{b.name}</span>
							{/* Divergence from the upstream. A deleted upstream is called out
						    rather than shown as "in sync", which is what 0/0 would look
						    like. */}
							{b.upstream_gone ? (
								<span
									className="sidebar-track is-gone"
									title="Upstream is gone"
								>
									gone
								</span>
							) : (
								<>
									{b.ahead > 0 && (
										<span
											className="sidebar-track"
											title={`${b.ahead} to push`}
										>
											↑{b.ahead}
										</span>
									)}
									{b.behind > 0 && (
										<span
											className="sidebar-track"
											title={`${b.behind} to pull`}
										>
											↓{b.behind}
										</span>
									)}
								</>
							)}
						</button>
					</div>
				))}
			</SidebarSection>

			{remoteGroups.map(([remote, branches]) => (
				<SidebarSection
					key={remote}
					title={remote}
					count={branches.length}
					icon={<Cloud />}
				>
					{branches.map((rb) => (
						<div key={rb.name} className="sidebar-row">
							{refButton(rb.name, rb.tip, "remote")}
						</div>
					))}
				</SidebarSection>
			))}

			<SidebarSection title="Tags" count={tags.length} icon={<Tag />}>
				{tags.map((t) => (
					<div key={t.name} className="sidebar-row">
						{refButton(t.name, t.tip, "tag")}
					</div>
				))}
			</SidebarSection>

			<SidebarSection
				title="Worktrees"
				count={filteredWorktrees.length}
				icon={<TreeStructure />}
			>
				{filteredWorktrees.map((w) => (
					// Static (there is no "open a worktree" action yet) but still
					// right-clickable: its path is the thing you most often want out of
					// this list, to cd into it.
					<div
						key={w.path}
						className="sidebar-row sidebar-static"
						title={w.path}
						onContextMenu={(e) => {
							e.preventDefault()
							const items: MenuItem[] = []
							if (w.branch !== null) {
								items.push({
									type: "item",
									label: "Copy Branch Name to Clipboard",
									onClick: () =>
										navigator.clipboard
											?.writeText(w.branch ?? "")
											.catch(() => {}),
								})
							}
							items.push({
								type: "item",
								label: "Copy Worktree Path to Clipboard",
								onClick: () =>
									navigator.clipboard?.writeText(w.path).catch(() => {}),
							})
							setMenu({ pos: { x: e.clientX, y: e.clientY }, items })
						}}
					>
						<span className="sidebar-ref-name">
							{w.branch ?? (w.is_detached ? "(detached)" : w.path)}
						</span>
					</div>
				))}
			</SidebarSection>

			<SidebarSection
				title="Stashes"
				count={filteredStashes.length}
				icon={<Stack />}
			>
				{filteredStashes.map((s) => (
					<div key={s.selector} className="sidebar-row">
						<button
							type="button"
							className={`sidebar-ref ${
								s.selector === activeStash ? "is-active" : ""
							}`}
							title={`${s.selector}: ${s.message}`}
							onClick={() => onSelectStash?.(s)}
							onContextMenu={(e) => {
								e.preventDefault()
								setMenu({
									pos: { x: e.clientX, y: e.clientY },
									items: [
										{
											type: "item",
											label: `Apply ${s.selector}`,
											onClick: () => onApplyStash?.(s),
										},
										{
											// Named for what it does rather than for git's verb:
											// "pop" is only obvious once you already know it.
											type: "item",
											label: `Pop ${s.selector} (apply and drop)`,
											onClick: () => onPopStash?.(s),
										},
										{
											type: "item",
											label: "Copy Stash Name to Clipboard",
											onClick: () =>
												navigator.clipboard
													?.writeText(s.selector)
													.catch(() => {}),
										},
										{
											type: "item",
											label: "Copy Stash Message to Clipboard",
											onClick: () =>
												navigator.clipboard
													?.writeText(s.message)
													.catch(() => {}),
										},
										{ type: "separator" },
										{ type: "item", label: `Drop ${s.selector}…`, wip: true },
									],
								})
							}}
						>
							{s.message}
						</button>
					</div>
				))}
			</SidebarSection>
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
