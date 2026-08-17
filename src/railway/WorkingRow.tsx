import { PencilSimple } from "@phosphor-icons/react"
import { CommitGraph } from "./CommitGraph"
import type { GraphRow } from "./graphLayout"
import type { WorkingCounts } from "./working"

/**
 * The uncommitted-changes row.
 *
 * It is a REAL node in the graph: `CommitRailway` injects it ahead of the
 * commits with HEAD as its parent, so `computeGraph` draws an actual edge down
 * its lane — through however many rows separate it from HEAD, which is usually
 * several, since HEAD is wherever the checked-out tip sorts by date. Its node is
 * hollow because it isn't a commit yet.
 *
 * Consequently this row SCROLLS with the list rather than being pinned above it:
 * a pinned row can't stay connected to a lane that scrolls underneath it.
 */
export function WorkingRow({
	counts,
	selected,
	graphRow,
	branch,
	headHash,
	onClick,
}: {
	counts: WorkingCounts
	selected: boolean
	graphRow: GraphRow
	// Branch HEAD is attached to, or null when detached / not loaded.
	branch: string | null
	headHash: string | null
	onClick: () => void
}) {
	const parts: string[] = []
	if (counts.staged > 0) parts.push(`${counts.staged} staged`)
	if (counts.unstaged > 0) parts.push(`${counts.unstaged} unstaged`)
	if (counts.untracked > 0) parts.push(`${counts.untracked} untracked`)
	const on =
		branch ?? (headHash === null ? null : `detached at ${headHash.slice(0, 7)}`)
	return (
		<button
			type="button"
			className={`commit-row is-working ${selected ? "is-selected" : ""}`}
			// Says out loud what the lane only implies.
			title={
				on === null ? "Uncommitted changes" : `Uncommitted changes on ${on}`
			}
			onClick={onClick}
		>
			<div className="commit-graph-cell">
				<CommitGraph row={graphRow} hollow={true} />
			</div>
			<div className="commit-desc">
				<span className="commit-subject working-label">
					<PencilSimple aria-hidden="true" /> Uncommitted changes
				</span>
				{on !== null && (
					<span className="working-on" title={on}>
						on {on}
					</span>
				)}
			</div>
			<span className="working-counts">{parts.join(" · ")}</span>
		</button>
	)
}
