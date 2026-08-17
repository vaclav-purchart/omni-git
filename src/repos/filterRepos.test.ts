import { describe, expect, it } from "vitest"
import { filterRepos } from "./filterRepos"

const repos = [
	{ id: "1", name: "configurator", path: "/code/configurator" },
	{ id: "2", name: "omni-git", path: "/repos/omni-git" },
	{ id: "3", name: "duplex", path: "/work/duplex-commander" },
]

describe("filterRepos", () => {
	it("returns all repos for an empty query", () => {
		expect(filterRepos(repos, "")).toHaveLength(3)
		expect(filterRepos(repos, "   ")).toHaveLength(3)
	})

	it("matches on name case-insensitively", () => {
		expect(filterRepos(repos, "OMNI").map((r) => r.id)).toEqual(["2"])
	})

	it("matches on path when name does not match", () => {
		expect(filterRepos(repos, "work").map((r) => r.id)).toEqual(["3"])
	})

	it("preserves input order", () => {
		expect(filterRepos(repos, "c").map((r) => r.id)).toEqual(["1", "3"])
	})
})
