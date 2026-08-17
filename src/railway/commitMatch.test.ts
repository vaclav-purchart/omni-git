import { describe, expect, it } from "vitest"
import { commitMatches, findMatches, isFilterActive } from "./commitMatch"

const c = (subject: string, author_name: string, hash = "abc123") => ({
	subject,
	author_name,
	hash,
})

describe("commitMatches", () => {
	it("matches everything when the filter is empty", () => {
		expect(commitMatches(c("anything", "Ada"), { query: "", author: "" })).toBe(
			true,
		)
	})
	it("matches subject case-insensitively", () => {
		expect(
			commitMatches(c("Fix the Bug", "Ada"), { query: "bug", author: "" }),
		).toBe(true)
		expect(
			commitMatches(c("Fix the Bug", "Ada"), { query: "feature", author: "" }),
		).toBe(false)
	})
	it("matches hash prefix", () => {
		expect(
			commitMatches(c("x", "Ada", "deadbeef"), { query: "dead", author: "" }),
		).toBe(true)
	})
	it("ANDs author with query", () => {
		expect(
			commitMatches(c("fix", "Ada Lovelace"), { query: "fix", author: "ada" }),
		).toBe(true)
		expect(
			commitMatches(c("fix", "Bob"), { query: "fix", author: "ada" }),
		).toBe(false)
	})
})

describe("isFilterActive", () => {
	it("is false only when both fields are blank/whitespace", () => {
		expect(isFilterActive({ query: "", author: "" })).toBe(false)
		expect(isFilterActive({ query: "  ", author: " " })).toBe(false)
		expect(isFilterActive({ query: "x", author: "" })).toBe(true)
		expect(isFilterActive({ query: "", author: "y" })).toBe(true)
	})
})

describe("findMatches", () => {
	it("returns matching indices, empty when inactive", () => {
		const commits = [c("fix a", "Ada"), c("feat b", "Bob"), c("fix c", "Ada")]
		expect(findMatches(commits, { query: "fix", author: "" })).toEqual([0, 2])
		expect(findMatches(commits, { query: "", author: "" })).toEqual([])
	})
})
