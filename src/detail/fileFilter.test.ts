import { describe, expect, it } from "vitest"
import {
	applyFileFilters,
	type FileFilter,
	fileFlags,
	matchFilePattern,
} from "./fileFilter"

function filter(overrides: Partial<FileFilter> = {}): FileFilter {
	return {
		id: "1",
		pattern: "*.test.*",
		mode: "hide",
		enabled: true,
		...overrides,
	}
}

describe("matchFilePattern", () => {
	it("matches a pattern without / against the basename only", () => {
		expect(matchFilePattern("*.test.*", "src/a/foo.test.ts")).toBe(true)
		expect(matchFilePattern("*.test.*", "foo.test.ts")).toBe(true)
	})

	it("matches a pattern with / against the full path", () => {
		expect(matchFilePattern("dist/**", "dist/assets/main.js")).toBe(true)
		expect(matchFilePattern("dist/**", "src/dist/main.js")).toBe(false)
		expect(matchFilePattern("src/**/foo.ts", "src/a/b/foo.ts")).toBe(true)
	})

	it("does not let a basename-only pattern match a directory segment elsewhere", () => {
		expect(matchFilePattern("foo.ts", "src/a/foo.ts")).toBe(true)
		expect(matchFilePattern("foo.ts", "src/a/foo.tsx")).toBe(false)
	})

	it("supports ? as a single non-slash wildcard", () => {
		expect(matchFilePattern("a?.ts", "ab.ts")).toBe(true)
		expect(matchFilePattern("a?.ts", "a.ts")).toBe(false)
		expect(matchFilePattern("a?.ts", "abc.ts")).toBe(false)
	})

	it("treats . as a literal character, not any-char", () => {
		expect(matchFilePattern("foo.ts", "fooXts")).toBe(false)
		expect(matchFilePattern("foo.ts", "foo.ts")).toBe(true)
	})

	it("matches case-insensitively", () => {
		expect(matchFilePattern("*.TEST.*", "src/foo.test.ts")).toBe(true)
		expect(matchFilePattern("FOO.ts", "foo.ts")).toBe(true)
	})

	it("never matches an empty or whitespace-only pattern", () => {
		expect(matchFilePattern("", "src/foo.ts")).toBe(false)
		expect(matchFilePattern("   ", "src/foo.ts")).toBe(false)
	})
})

describe("fileFlags", () => {
	it("ignores disabled filters", () => {
		const filters = [filter({ enabled: false, pattern: "*.ts" })]
		expect(fileFlags("src/foo.ts", filters)).toEqual({
			hidden: false,
			highlighted: false,
		})
	})

	it("sets both hidden and highlighted when matched by both modes", () => {
		const filters = [
			filter({ id: "1", pattern: "*.ts", mode: "hide" }),
			filter({ id: "2", pattern: "*.ts", mode: "highlight" }),
		]
		expect(fileFlags("src/foo.ts", filters)).toEqual({
			hidden: true,
			highlighted: true,
		})
	})

	it("reports no flags when nothing matches", () => {
		const filters = [filter({ pattern: "*.md" })]
		expect(fileFlags("src/foo.ts", filters)).toEqual({
			hidden: false,
			highlighted: false,
		})
	})
})

describe("applyFileFilters", () => {
	it("removes hidden files and files hidden via hideTests", () => {
		const files = [
			{ path: "src/foo.ts" },
			{ path: "src/foo.test.ts" },
			{ path: "src/bar.gen.ts" },
		]
		const filters = [filter({ pattern: "*.gen.ts", mode: "hide" })]
		const result = applyFileFilters(files, filters, true)
		expect(result.visible.map((f) => f.path)).toEqual(["src/foo.ts"])
	})

	it("counts all test files regardless of hideTests", () => {
		const files = [
			{ path: "src/foo.test.ts" },
			{ path: "src/bar.spec.ts" },
			{ path: "src/baz.ts" },
		]
		expect(applyFileFilters(files, [], false).testCount).toBe(2)
		expect(applyFileFilters(files, [], true).testCount).toBe(2)
	})

	it("only includes still-visible paths in highlighted", () => {
		const files = [{ path: "src/foo.ts" }, { path: "src/bar.ts" }]
		const filters = [
			filter({ id: "1", pattern: "*.ts", mode: "highlight" }),
			filter({ id: "2", pattern: "bar.ts", mode: "hide" }),
		]
		const result = applyFileFilters(files, filters, false)
		expect(result.visible.map((f) => f.path)).toEqual(["src/foo.ts"])
		expect(result.highlighted).toEqual(new Set(["src/foo.ts"]))
	})

	it("hide wins when a path matches both a hide and a highlight filter", () => {
		const files = [{ path: "src/foo.ts" }]
		const filters = [
			filter({ id: "1", pattern: "*.ts", mode: "hide" }),
			filter({ id: "2", pattern: "*.ts", mode: "highlight" }),
		]
		const result = applyFileFilters(files, filters, false)
		expect(result.visible).toEqual([])
		expect(result.highlighted.has("src/foo.ts")).toBe(false)
	})
})
