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

	it("returns exactly one entry per text line", () => {
		const diff = "@@ -1 +1 @@\n context\n"
		expect(computeLineNumbers(diff).length).toBe(diff.split("\n").length)
	})
})
