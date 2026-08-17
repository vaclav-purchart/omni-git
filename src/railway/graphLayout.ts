export type GraphInput = {
	hash: string
	parents: string[]
	/**
	 * Draw this node's lane dashed for its whole run.
	 *
	 * For the uncommitted-changes node: its edge to HEAD is real, but it isn't a
	 * branch, and a solid line made it read as one. Dashing has to be a property
	 * of the LANE rather than of one row, because the edge spans every row
	 * between the node and HEAD — and must go back to solid below HEAD, where
	 * the same lane carries ordinary history.
	 */
	dashed?: boolean
}
export type EdgeIn = { fromCol: number; color: number; dashed: boolean }
export type EdgeOut = { toCol: number; color: number; dashed: boolean }
export type PassLine = { col: number; color: number; dashed: boolean }
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
	// Parallel to `lanes`: whether the open edge in this column should be dashed.
	const laneDashed: boolean[] = []
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
		const topDashed = laneDashed.slice()

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
		const bottomDashed = topDashed.slice()
		// Whatever this node sends downwards inherits ITS dashed-ness, which is
		// what makes the lane revert to solid once a real commit takes it over.
		const dashed = commit.dashed === true
		for (const c of incomingCols) {
			bottom[c] = null
		}
		bottom[col] = null // node lane is (re)assigned below if it has a first parent

		const outgoing: EdgeOut[] = []
		commit.parents.forEach((parent, i) => {
			if (i === 0) {
				bottom[col] = parent
				bottomColor[col] = color
				bottomDashed[col] = dashed
				outgoing.push({ toCol: col, color, dashed })
			} else {
				// Merge into a lane already waiting for this parent, else open one.
				let target = bottom.indexOf(parent)
				if (target === -1) {
					target = firstFree(bottom)
					bottomColor[target] = newColor()
				}
				bottom[target] = parent
				bottomDashed[target] = dashed
				outgoing.push({ toCol: target, color: bottomColor[target], dashed })
			}
		})

		const incoming: EdgeIn[] = incomingCols.map((c) => ({
			fromCol: c,
			color: topColor[c],
			dashed: topDashed[c] === true,
		}))

		const width = Math.max(top.length, bottom.length, col + 1)
		const passThrough: PassLine[] = []
		for (let c = 0; c < width; c++) {
			if (c !== col && top[c] != null && bottom[c] === top[c]) {
				passThrough.push({
					col: c,
					color: topColor[c],
					dashed: topDashed[c] === true,
				})
			}
		}

		rows.push({ col, color, width, incoming, outgoing, passThrough })

		// Commit bottom state back into the working lanes, trimming trailing nulls.
		lanes.length = 0
		laneColor.length = 0
		laneDashed.length = 0
		for (let c = 0; c < bottom.length; c++) {
			lanes[c] = bottom[c]
			laneColor[c] = bottomColor[c]
			laneDashed[c] = bottomDashed[c] === true
		}
		while (lanes.length > 0 && lanes[lanes.length - 1] == null) {
			lanes.pop()
			laneColor.pop()
			laneDashed.pop()
		}
	}

	return rows
}
