import { describe, expect, it } from "vitest"
import { findMatches, matchIndexAt, stepIndex } from "./searchMatches"

const TEXT = ["const foo = 1", "// FOO again", "let food = foo"].join("\n")

describe("findMatches", () => {
	it("finds every occurrence, in document order", () => {
		const m = findMatches(TEXT, "foo")

		expect(m).toEqual([
			{ from: 6, to: 9 },
			{ from: 17, to: 20 },
			{ from: 31, to: 34 },
			{ from: 38, to: 41 },
		])
	})

	// Case-insensitive by default: the railway search sets that precedent, and
	// nobody hunting through a diff wants to think about case.
	it("is case-insensitive", () => {
		expect(findMatches("Foo foo FOO", "foo")).toHaveLength(3)
	})

	it("finds nothing for an empty query", () => {
		expect(findMatches(TEXT, "")).toEqual([])
		expect(findMatches(TEXT, "   ")).toEqual([])
	})

	it("finds nothing when the query is absent", () => {
		expect(findMatches(TEXT, "zzz")).toEqual([])
	})

	// A diff is full of regex metacharacters (`+`, `-`, `@@`, `.`), and searching
	// for them must be literal rather than blowing up or matching wildly.
	it("treats the query as literal text", () => {
		expect(findMatches("a+b a.b", "a+b")).toEqual([{ from: 0, to: 3 }])
		expect(findMatches("a+b axb", "a.b")).toEqual([])
		expect(findMatches("@@ -1 +1 @@", "@@")).toHaveLength(2)
	})

	// Overlapping candidates: git diffs contain runs like `-----` and `+++`.
	it("does not return overlapping matches", () => {
		expect(findMatches("aaaa", "aa")).toEqual([
			{ from: 0, to: 2 },
			{ from: 2, to: 4 },
		])
	})

	// The whole document is scanned, so a pathological query on a huge diff must
	// not be unbounded. Beyond the cap the count is honest about being partial.
	it("caps how many matches it collects", () => {
		const many = "x".repeat(20000)

		const m = findMatches(many, "x")

		expect(m.length).toBe(5000)
	})
})

describe("stepIndex", () => {
	it("advances and wraps forward", () => {
		expect(stepIndex(0, 3, 1)).toBe(1)
		expect(stepIndex(2, 3, 1)).toBe(0)
	})

	it("retreats and wraps backward", () => {
		expect(stepIndex(1, 3, -1)).toBe(0)
		expect(stepIndex(0, 3, -1)).toBe(2)
	})

	it("stays at -1 when there is nothing to step through", () => {
		expect(stepIndex(-1, 0, 1)).toBe(-1)
		expect(stepIndex(-1, 0, -1)).toBe(-1)
	})

	// Opening the bar selects nothing; the first next/prev picks a real match
	// rather than skipping the first one.
	it("selects the first match from nothing, and the last going backward", () => {
		expect(stepIndex(-1, 3, 1)).toBe(0)
		expect(stepIndex(-1, 3, -1)).toBe(2)
	})
})

describe("matchIndexAt", () => {
	const matches = [
		{ from: 10, to: 13 },
		{ from: 20, to: 23 },
		{ from: 30, to: 33 },
	]

	// Re-typing a query re-finds everything, and the match nearest where the user
	// already is should stay selected rather than jumping back to the top.
	it("finds the first match at or after a position", () => {
		expect(matchIndexAt(matches, 0)).toBe(0)
		expect(matchIndexAt(matches, 20)).toBe(1)
		expect(matchIndexAt(matches, 21)).toBe(2)
	})

	it("wraps to the first match past the last one", () => {
		expect(matchIndexAt(matches, 999)).toBe(0)
	})

	it("has no index when there are no matches", () => {
		expect(matchIndexAt([], 0)).toBe(-1)
	})
})
