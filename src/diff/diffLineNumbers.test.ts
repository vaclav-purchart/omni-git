import { describe, expect, it } from "vitest"
import { computeLineNumbers } from "./diffLineNumbers"

describe("computeLineNumbers", () => {
	it("assigns old/new source line numbers from hunk headers", () => {
		const diff = [
			"diff --git a/f b/f",
			"index 000..111 100644",
			"--- a/f",
			"+++ b/f",
			"@@ -1,3 +1,4 @@",
			" context1",
			"-removed",
			"+added1",
			"+added2",
			" context2",
		].join("\n")
		const nums = computeLineNumbers(diff)
		expect(nums[0]).toEqual({ old: null, new: null }) // diff --git (meta)
		expect(nums[3]).toEqual({ old: null, new: null }) // +++ b/f (meta)
		expect(nums[4]).toEqual({ old: null, new: null }) // @@ hunk header
		expect(nums[5]).toEqual({ old: 1, new: 1 }) // context1
		expect(nums[6]).toEqual({ old: 2, new: null }) // -removed
		expect(nums[7]).toEqual({ old: null, new: 2 }) // +added1
		expect(nums[8]).toEqual({ old: null, new: 3 }) // +added2
		expect(nums[9]).toEqual({ old: 3, new: 4 }) // context2
	})

	it("handles single-line hunk headers without commas", () => {
		const nums = computeLineNumbers("@@ -5 +7 @@\n context\n+added")
		expect(nums[1]).toEqual({ old: 5, new: 7 })
		expect(nums[2]).toEqual({ old: null, new: 8 })
	})

	// A conflicted file is the one case git answers with a COMBINED diff: two
	// prefix columns instead of one, and a `@@@ -a -b +c @@@` header. Verbatim
	// output from `git diff` on an unmerged path.
	describe("a combined (conflict) diff", () => {
		const COMBINED = [
			"diff --cc f.tsx",
			"index d791e9b,00dbdcf..0000000",
			"--- a/f.tsx",
			"+++ b/f.tsx",
			"@@@ -10,3 -12,3 +20,7 @@@",
			"  line1",
			"++<<<<<<< HEAD",
			" +MAIN",
			"++=======",
			"+ FEATURE",
			"++>>>>>>> feature",
			"  line3",
		].join("\n")

		it("numbers the merged result on the new side", () => {
			const nums = computeLineNumbers(COMBINED)

			// 20..26, matching the header's `+20,7`.
			expect(nums.slice(5).map((n) => n.new)).toEqual([
				20, 21, 22, 23, 24, 25, 26,
			])
		})

		// The old gutter follows the FIRST parent — ours/HEAD during a merge — which
		// is the side the user is reconciling against. A line added relative to it
		// has no number there.
		it("numbers the first parent on the old side", () => {
			const nums = computeLineNumbers(COMBINED)

			expect(nums.slice(5).map((n) => n.old)).toEqual([
				10,
				null,
				11,
				null,
				null,
				null,
				12,
			])
		})

		it("treats the combined header as a hunk, not as content", () => {
			const nums = computeLineNumbers(COMBINED)

			expect(nums[4]).toEqual({ old: null, new: null })
		})

		// The regression this guards: the old header regex required exactly two `@`,
		// so a combined hunk was read as a content line and every number after it
		// was wrong — the symptom being a conflicted file with no usable gutter.
		it("does not mistake the combined header for a context line", () => {
			const nums = computeLineNumbers(COMBINED)

			expect(nums[5]).toEqual({ old: 10, new: 20 })
		})
	})

	it("returns exactly one entry per text line", () => {
		const diff = "@@ -1 +1 @@\n context\n"
		expect(computeLineNumbers(diff).length).toBe(diff.split("\n").length)
	})
})
