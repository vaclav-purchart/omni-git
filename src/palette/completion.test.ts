import { describe, expect, it } from "vitest"
import {
	applyCompletion,
	completionCandidates,
	completionContext,
	GIT_SUBCOMMANDS,
	longestCommonPrefix,
} from "./completion"

const REFS = [
	"main",
	"develop",
	"fix/P20009663-13723-properties",
	"origin/main",
]

describe("completionContext", () => {
	it("completes the first word as a subcommand", () => {
		expect(completionContext("che")).toEqual({
			kind: "subcommand",
			prefix: "che",
			start: 0,
		})
	})

	// `checkout ma` wants branches, not subcommands.
	it("completes later words as refs", () => {
		expect(completionContext("checkout ma")).toEqual({
			kind: "ref",
			prefix: "ma",
			start: 9,
		})
	})

	// The backend accepts a leading `git` too, so completion must agree.
	it("ignores a leading git", () => {
		expect(completionContext("git che").kind).toBe("subcommand")
		expect(completionContext("git checkout ma").kind).toBe("ref")
	})

	it("treats a trailing space as the start of a new word", () => {
		expect(completionContext("checkout ")).toEqual({
			kind: "ref",
			prefix: "",
			start: 9,
		})
	})

	it("handles an empty input", () => {
		expect(completionContext("")).toEqual({
			kind: "subcommand",
			prefix: "",
			start: 0,
		})
	})
})

describe("completionCandidates", () => {
	it("prefix-matches subcommands", () => {
		const got = completionCandidates(completionContext("che"), { refs: [] })

		expect(got).toContain("checkout")
		expect(got).toContain("cherry-pick")
		expect(got).not.toContain("commit")
	})

	it("is case-insensitive", () => {
		expect(
			completionCandidates(completionContext("CHECK"), { refs: [] }),
		).toContain("checkout")
	})

	it("prefix-matches refs for later words", () => {
		const got = completionCandidates(completionContext("checkout ma"), {
			refs: REFS,
		})

		expect(got).toContain("main")
		expect(got).not.toContain("develop")
	})

	// Branch names like `fix/P20009663-13723-…` are unusable with prefix-only
	// matching: nobody remembers the leading digits, they remember the ticket.
	it("matches a ref's middle, ranking head matches first", () => {
		const got = completionCandidates(completionContext("checkout main"), {
			refs: REFS,
		})

		expect(got).toEqual(["main", "origin/main"])
	})

	it("finds a branch by a fragment of its name", () => {
		expect(
			completionCandidates(completionContext("checkout 13723"), { refs: REFS }),
		).toEqual(["fix/P20009663-13723-properties"])
	})

	// Substring matching is for refs only — it would make subcommands noisy
	// (`t` should not offer everything containing a "t").
	it("does not substring-match subcommands", () => {
		expect(
			completionCandidates(completionContext("ush"), { refs: [] }),
		).toEqual([])
	})

	it("offers everything for an empty prefix", () => {
		expect(
			completionCandidates(completionContext(""), { refs: [] }).length,
		).toBe(GIT_SUBCOMMANDS.length)
	})
})

describe("longestCommonPrefix", () => {
	it("finds the shared prefix", () => {
		expect(longestCommonPrefix(["checkout", "cherry-pick"])).toBe("che")
	})

	it("is the whole value for a single candidate", () => {
		expect(longestCommonPrefix(["checkout"])).toBe("checkout")
	})

	it("is empty when candidates diverge immediately or there are none", () => {
		expect(longestCommonPrefix(["add", "branch"])).toBe("")
		expect(longestCommonPrefix([])).toBe("")
	})
})

describe("applyCompletion", () => {
	it("replaces the word being completed", () => {
		const input = "checkout ma"

		expect(applyCompletion(input, completionContext(input), "main", true)).toBe(
			"checkout main ",
		)
	})

	// A partial (common-prefix) completion must not add a space, or the next Tab
	// would be completing a fresh empty word instead of continuing this one.
	it("omits the trailing space for an unfinished word", () => {
		expect(applyCompletion("che", completionContext("che"), "che", false)).toBe(
			"che",
		)
	})

	it("preserves the earlier part of the line", () => {
		const input = "git checkout fi"

		expect(
			applyCompletion(input, completionContext(input), "fix/x", true),
		).toBe("git checkout fix/x ")
	})
})
