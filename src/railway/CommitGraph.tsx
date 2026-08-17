import { LANE_WIDTH, laneColor, ROW_HEIGHT } from "./graphConstants"
import type { GraphRow } from "./graphLayout"

// Dash pattern for a lane that isn't real history — currently only the
// uncommitted-changes node's edge down to HEAD.
const DASH = "3 3"

function cx(col: number): number {
	return col * LANE_WIDTH + LANE_WIDTH / 2
}

export function CommitGraph({
	row,
	isHead = false,
	hollow = false,
}: {
	row: GraphRow
	// Draws the HEAD commit's node larger and ringed, SourceTree-style. Radius
	// and stroke are kept within LANE_WIDTH/2 so the node can't clip at the
	// svg's edge on lane 0.
	isHead?: boolean
	// An outlined node instead of a filled one, for the uncommitted-changes row:
	// its edges are real, but it isn't a commit yet.
	hollow?: boolean
}) {
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
					strokeDasharray={l.dashed ? DASH : undefined}
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
					strokeDasharray={e.dashed ? DASH : undefined}
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
					strokeDasharray={e.dashed ? DASH : undefined}
					fill="none"
				/>
			))}
			<circle
				cx={nodeX}
				cy={midY}
				r={isHead ? 5.5 : 4}
				fill={hollow ? "var(--bg)" : laneColor(row.color)}
				stroke={
					hollow ? laneColor(row.color) : isHead ? "var(--added)" : undefined
				}
				strokeWidth={hollow || isHead ? 2 : undefined}
			/>
		</svg>
	)
}
