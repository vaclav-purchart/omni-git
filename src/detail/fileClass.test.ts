import { describe, expect, it } from "vitest"
import { isTestFile } from "./fileClass"

describe("isTestFile", () => {
	it("matches .test. and .spec. in the filename", () => {
		expect(isTestFile("src/foo.test.ts")).toBe(true)
		expect(isTestFile("src/Bar.spec.tsx")).toBe(true)
		expect(isTestFile("a/b/x.test.js")).toBe(true)
		expect(isTestFile("pkg/y.SPEC.ts")).toBe(true)
	})
	it("does not match non-test files", () => {
		expect(isTestFile("src/foo.ts")).toBe(false)
		expect(isTestFile("src/contest.ts")).toBe(false)
		expect(isTestFile("spec/readme.md")).toBe(false)
		expect(isTestFile("test/helpers.ts")).toBe(false)
	})
})
