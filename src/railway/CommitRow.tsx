import type { CommitSummary } from "../ipc/bindings"
import { formatRelative } from "../time"
import { CommitGraph } from "./CommitGraph"
import type { GraphRow } from "./graphLayout"
import { isHeadCommit, type ParsedRef, parseRef } from "./refKind"

export function CommitRow({
	commit,
	graphRow,
	nowMs,
	selected,
	inSelection = false,
	matched,
	onClick,
	onContextMenu,
	onRefContextMenu,
}: {
	commit: CommitSummary
	graphRow: GraphRow
	nowMs: number
	selected: boolean
	/** In a multi-selection of more than one commit. */
	inSelection?: boolean
	matched: boolean
	onClick: (e: React.MouseEvent) => void
	onContextMenu?: (commit: CommitSummary, e: React.MouseEvent) => void
	// Right-clicking a badge acts on that ref, not on the commit under it —
	// reaching a branch shouldn't mean hunting for it in the sidebar.
	onRefContextMenu?: (
		ref: ParsedRef,
		commit: CommitSummary,
		e: React.MouseEvent,
	) => void
}) {
	// Where the repo actually is, which is usually NOT the row being inspected.
	// Deliberately styled as a left edge marker rather than a background, so it
	// stays readable when this row is also selected or a search match.
	const isHead = isHeadCommit(commit.refs)
	return (
		<button
			type="button"
			className={`commit-row ${selected ? "is-selected" : ""} ${inSelection ? "is-in-selection" : ""} ${matched ? "is-matched" : ""} ${isHead ? "is-head" : ""}`}
			aria-selected={selected || inSelection}
			// Announces "this is the checked-out commit" to assistive tech, which a
			// purely visual marker cannot.
			aria-current={isHead ? "true" : undefined}
			title={isHead ? "Checked out (HEAD)" : undefined}
			onClick={(e) => onClick(e)}
			onContextMenu={(e) => onContextMenu?.(commit, e)}
		>
			{/* Fixed width across all rows so the text column doesn't jitter as
			    lane count changes; edges draw at absolute columns from x=0. */}
			<div className="commit-graph-cell">
				<CommitGraph row={graphRow} isHead={isHead} />
			</div>
			<div className="commit-desc">
				{commit.refs.length > 0 && (
					<div className="commit-refs">
						{commit.refs.map((r) => {
							const parsed = parseRef(r)
							return (
								// A span, not a button: the whole row is already a button, and
								// nesting one inside another is invalid. Right-click needs no
								// focusability, so a span carries the handler fine.
								<span
									key={r}
									className={`commit-ref ref-${parsed.kind} ${parsed.isHead ? "is-head" : ""}`}
									title={r}
									onContextMenu={(e) => {
										if (!onRefContextMenu) {
											return
										}
										// Without this the row's own handler also fires and
										// replaces the ref menu with the commit menu.
										e.preventDefault()
										e.stopPropagation()
										onRefContextMenu(parsed, commit, e)
									}}
								>
									{parsed.label}
								</span>
							)
						})}
					</div>
				)}
				<span className="commit-subject" title={commit.subject}>
					{commit.subject}
				</span>
			</div>
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
		</button>
	)
}
