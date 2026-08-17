import { describe, expect, it } from "vitest"
import { classifyDiffLine } from "./diffHighlight"

describe("classifyDiffLine", () => {
	it("classifies hunk headers", () => {
		expect(classifyDiffLine("@@ -1,3 +1,4 @@")).toBe("hunk")
	})
	it("classifies added and removed lines", () => {
		expect(classifyDiffLine("+added")).toBe("add")
		expect(classifyDiffLine("-removed")).toBe("del")
	})
	it("treats file markers as meta, not add/del", () => {
		expect(classifyDiffLine("+++ b/file.ts")).toBe("meta")
		expect(classifyDiffLine("--- a/file.ts")).toBe("meta")
		expect(classifyDiffLine("diff --git a/x b/x")).toBe("meta")
		expect(classifyDiffLine("index e69de29..0cfbf08")).toBe("meta")
	})
	it("classifies context lines", () => {
		expect(classifyDiffLine(" unchanged")).toBe("context")
		expect(classifyDiffLine("")).toBe("context")
	})
})
