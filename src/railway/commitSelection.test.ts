import { describe, expect, it } from "vitest"
import { hashRange, orderedSelection, toggleHash } from "./commitSelection"

const LOG = ["c1", "c2", "c3", "c4", "c5"]

describe("toggleHash", () => {
	it("adds a hash that isn't selected", () => {
		expect(toggleHash(new Set(["c1"]), "c3")).toEqual(new Set(["c1", "c3"]))
	})

	it("removes one that is", () => {
		expect(toggleHash(new Set(["c1", "c3"]), "c3")).toEqual(new Set(["c1"]))
	})

	it("does not mutate the set it was given", () => {
		const original = new Set(["c1"])

		toggleHash(original, "c2")

		expect(original).toEqual(new Set(["c1"]))
	})
})

describe("hashRange", () => {
	it("returns the commits between anchor and target", () => {
		expect(hashRange(LOG, "c2", "c4")).toEqual(["c2", "c3", "c4"])
	})

	// A range dragged up the log is the same range; the result stays in log order
	// so callers never re-sort.
	it("is the same range when dragged upwards", () => {
		expect(hashRange(LOG, "c4", "c2")).toEqual(["c2", "c3", "c4"])
	})

	it("is a single commit when the anchor is the target", () => {
		expect(hashRange(LOG, "c3", "c3")).toEqual(["c3"])
	})

	// Shift+click with nothing selected yet has no anchor to measure from.
	it("is just the clicked commit with no anchor", () => {
		expect(hashRange(LOG, null, "c3")).toEqual(["c3"])
	})

	// The log is paginated, so an anchor selected earlier can have been dropped by
	// a reload. Better one commit than a range measured from a guess.
	it("is just the clicked commit when the anchor is no longer loaded", () => {
		expect(hashRange(LOG, "gone", "c3")).toEqual(["c3"])
	})

	it("is empty when the target itself isn't loaded", () => {
		expect(hashRange(LOG, "c1", "gone")).toEqual([])
	})
})

describe("orderedSelection", () => {
	it("returns log order, not the order commits were picked", () => {
		expect(orderedSelection(LOG, new Set(["c4", "c1", "c3"]))).toEqual([
			"c1",
			"c3",
			"c4",
		])
	})

	it("drops hashes that are no longer loaded", () => {
		expect(orderedSelection(LOG, new Set(["c2", "gone"]))).toEqual(["c2"])
	})

	it("is empty for an empty selection", () => {
		expect(orderedSelection(LOG, new Set())).toEqual([])
	})
})
