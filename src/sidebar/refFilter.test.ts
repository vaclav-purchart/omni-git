import { describe, expect, it } from "vitest"
import { filterNames, isSubsequence, matchRef } from "./refFilter"

describe("matchRef", () => {
	// The whole point: branch names are paths, and the memorable part is in the
	// middle. Prefix matching would be nearly useless.
	it("matches a substring anywhere in the name", () => {
		expect(matchRef("feature/JIRA-4821-retry-logic", "4821")).toBe("substring")
		expect(matchRef("feature/JIRA-4821-retry-logic", "retry")).toBe("substring")
		expect(matchRef("feature/JIRA-4821-retry-logic", "feature")).toBe(
			"substring",
		)
	})

	it("ignores case", () => {
		expect(matchRef("Feature/JIRA-4821", "jira")).toBe("substring")
		expect(matchRef("feature/jira-4821", "JIRA")).toBe("substring")
	})

	// Spaces are how people separate the bits they remember, so they're treated as
	// "all of these, anywhere" rather than matched literally.
	it("treats a space-separated query as several substrings", () => {
		expect(matchRef("feature/JIRA-4821-retry-logic", "feat retry")).toBe(
			"substring",
		)
		expect(matchRef("feature/JIRA-4821-retry-logic", "retry feat")).toBe(
			"substring",
		)
		expect(matchRef("feature/JIRA-4821-retry-logic", "feat nope")).toBe(null)
	})

	it("falls back to a subsequence", () => {
		expect(matchRef("feature/JIRA-4821-retry-logic", "j4821retry")).toBe(
			"subsequence",
		)
		expect(matchRef("release/1.2.0", "r120")).toBe("subsequence")
	})

	it("does not match when the characters are out of order", () => {
		expect(matchRef("feature/retry", "yrter")).toBe(null)
	})

	it("does not match unrelated names", () => {
		expect(matchRef("main", "feature")).toBe(null)
	})

	// An empty query is not a filter.
	it("matches everything for an empty query", () => {
		expect(matchRef("anything", "")).toBe("substring")
		expect(matchRef("anything", "   ")).toBe("substring")
	})

	it("ignores surrounding whitespace", () => {
		expect(matchRef("feature/retry", "  retry  ")).toBe("substring")
	})
})

describe("isSubsequence", () => {
	it("accepts characters in order with gaps", () => {
		expect(isSubsequence("feature/retry", "fry")).toBe(true)
	})

	it("rejects characters out of order", () => {
		expect(isSubsequence("abc", "cba")).toBe(false)
	})

	it("rejects a query longer than what remains", () => {
		expect(isSubsequence("ab", "abc")).toBe(false)
	})

	it("accepts an empty query", () => {
		expect(isSubsequence("abc", "")).toBe(true)
	})
})

describe("filterNames", () => {
	const names = [
		"main",
		"develop",
		"feature/JIRA-4821-retry-logic",
		"my-feature/admin-panel",
		"release/1.2.0",
	]
	const filter = (q: string) => filterNames(names, (n) => n, q)

	it("returns everything for an empty query", () => {
		expect(filter("")).toEqual(names)
	})

	it("keeps the original order", () => {
		expect(filter("e")).toEqual(names.filter((n) => n.includes("e")))
	})

	// A subsequence match on the same query would also drag in
	// `my-feature/admin-panel`, burying the branch actually asked for.
	it("drops subsequence matches when anything matched as a substring", () => {
		expect(filter("main")).toEqual(["main"])
	})

	it("falls back to subsequence matches when nothing matched as a substring", () => {
		expect(filter("j4821retry")).toEqual(["feature/JIRA-4821-retry-logic"])
	})

	it("returns nothing when nothing matches", () => {
		expect(filter("zzzz")).toEqual([])
	})

	it("reads the name through the accessor", () => {
		const refs = [{ name: "main" }, { name: "feature/retry" }]

		expect(filterNames(refs, (r) => r.name, "retry")).toEqual([
			{ name: "feature/retry" },
		])
	})
})
