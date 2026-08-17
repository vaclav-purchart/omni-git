import { describe, expect, it } from "vitest"
import { isBinaryPatch } from "./binaryPatch"

describe("isBinaryPatch", () => {
	// The reported case: a .ts file with a real NUL in a string literal, which git
	// therefore calls binary. Rendered raw, this looked like a broken diff.
	it("detects git's binary placeholder for a new file", () => {
		const patch = [
			"diff --git a/src/utils/seededRandom.ts b/src/utils/seededRandom.ts",
			"new file mode 100644",
			"index 00000000..cd519713",
			"Binary files /dev/null and b/src/utils/seededRandom.ts differ",
		].join("\n")

		expect(isBinaryPatch(patch)).toBe(true)
	})

	it("detects it for a modified file", () => {
		expect(isBinaryPatch("Binary files a/f.ts and b/f.ts differ\n")).toBe(true)
	})

	it("detects a real binary patch body", () => {
		expect(
			isBinaryPatch("diff --git a/i.png b/i.png\nGIT binary patch\n"),
		).toBe(true)
	})

	it("is false for an ordinary text diff", () => {
		const patch = [
			"diff --git a/f.ts b/f.ts",
			"--- a/f.ts",
			"+++ b/f.ts",
			"@@ -1 +1,2 @@",
			" const a = 1",
			"+const b = 2",
		].join("\n")

		expect(isBinaryPatch(patch)).toBe(false)
	})

	it("is false for an empty patch", () => {
		expect(isBinaryPatch("")).toBe(false)
		expect(isBinaryPatch("\n\n")).toBe(false)
	})

	// Matched per line, so a diff whose CONTENT mentions the phrase — a test
	// fixture asserting on git's output, say — isn't mistaken for one.
	it("is not fooled by the phrase appearing inside a diff line", () => {
		const patch = [
			"@@ -1 +1,2 @@",
			'+expect(out).toBe("Binary files a/x and b/x differ")',
		].join("\n")

		expect(isBinaryPatch(patch)).toBe(false)
	})

	it("tolerates trailing whitespace", () => {
		expect(isBinaryPatch("Binary files a/f and b/f differ  \n")).toBe(true)
	})
})
