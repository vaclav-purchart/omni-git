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
		expect(rows[0].outgoing).toEqual([
			{ toCol: 0, color: rows[0].color, dashed: false },
		])
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

describe("computeGraph with an injected working node", () => {
	// How the uncommitted-changes row gets a REAL connection: it's injected as
	// row 0 with HEAD as its parent. HEAD is usually several rows down (it's
	// wherever the checked-out tip sorts by date), so the lane has to be carried
	// through every row in between — which is what makes this honest, versus a
	// stub pointing at whatever happens to be adjacent.
	it("carries the working node's lane down to HEAD", () => {
		const rows = computeGraph(
			[
				{ hash: "WORKING", parents: ["head"] },
				{ hash: "other1", parents: ["other2"] },
				{ hash: "other2", parents: ["head"] },
				{ hash: "head", parents: ["older"] },
				{ hash: "older", parents: [] },
			],
			8,
		)

		// Row 0 opens a lane and sends an edge down it.
		expect(rows[0].outgoing).toEqual([{ toCol: 0, color: 0, dashed: false }])

		// The rows BETWEEN keep that lane alive as a pass-through, so the line is
		// continuous rather than stopping at the row below.
		expect(rows[1].passThrough.some((p) => p.col === 0)).toBe(true)
		expect(rows[2].passThrough.some((p) => p.col === 0)).toBe(true)

		// HEAD's row receives it.
		expect(rows[3].incoming.some((e) => e.fromCol === 0)).toBe(true)
		expect(rows[3].col).toBe(0)
	})

	// An unborn branch, or HEAD not among the loaded page: an isolated node beats
	// an edge to nowhere.
	it("leaves a parentless working node unconnected", () => {
		const rows = computeGraph(
			[
				{ hash: "WORKING", parents: [] },
				{ hash: "c1", parents: [] },
			],
			8,
		)

		expect(rows[0].outgoing).toEqual([])
		expect(rows[1].passThrough).toEqual([])
	})
})

describe("dashed lanes", () => {
	// A dashed node's lane must stay dashed for its WHOLE run — including the
	// pass-through rows between it and its parent — and must go back to solid
	// once a real commit takes the lane over, or ordinary history below HEAD
	// would render as though it weren't real either.
	it("dashes the run from a dashed node down to its parent, then goes solid", () => {
		const rows = computeGraph(
			[
				{ hash: "WORKING", parents: ["head"], dashed: true },
				{ hash: "other", parents: ["head"] },
				{ hash: "head", parents: ["older"] },
				{ hash: "older", parents: [] },
			],
			8,
		)

		// The dashed node's own outgoing edge.
		expect(rows[0].outgoing[0].dashed).toBe(true)
		// Carried across the row in between.
		expect(rows[1].passThrough.find((p) => p.col === 0)?.dashed).toBe(true)
		// Arrives at HEAD still dashed.
		expect(rows[2].incoming.find((e) => e.fromCol === 0)?.dashed).toBe(true)
		// …but HEAD's own history below it is real, so solid again.
		expect(rows[2].outgoing.every((e) => e.dashed)).toBe(false)
		expect(rows[3].incoming.every((e) => e.dashed)).toBe(false)
	})

	it("leaves an ordinary graph entirely solid", () => {
		const rows = computeGraph(
			[
				{ hash: "a", parents: ["b"] },
				{ hash: "b", parents: [] },
			],
			8,
		)

		expect(rows.every((r) => r.outgoing.every((e) => !e.dashed))).toBe(true)
		expect(rows.every((r) => r.incoming.every((e) => !e.dashed))).toBe(true)
		expect(rows.every((r) => r.passThrough.every((p) => !p.dashed))).toBe(true)
	})
})
