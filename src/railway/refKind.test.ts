import { describe, expect, it } from "vitest"
import { headBranchName, isHeadCommit, parseRef } from "./refKind"

describe("parseRef", () => {
	it("classifies a checked-out local branch", () => {
		expect(parseRef("HEAD -> refs/heads/main")).toEqual({
			kind: "local",
			label: "main",
			isHead: true,
		})
	})
	it("classifies a local branch with slashes", () => {
		expect(parseRef("refs/heads/feature/x")).toEqual({
			kind: "local",
			label: "feature/x",
			isHead: false,
		})
	})
	it("classifies a remote branch", () => {
		expect(parseRef("refs/remotes/origin/main")).toEqual({
			kind: "remote",
			label: "origin/main",
			isHead: false,
		})
	})
	it("classifies a tag", () => {
		expect(parseRef("tag: refs/tags/v1")).toEqual({
			kind: "tag",
			label: "v1",
			isHead: false,
		})
	})
	it("handles detached HEAD", () => {
		expect(parseRef("HEAD")).toEqual({
			kind: "head",
			label: "HEAD",
			isHead: true,
		})
	})
})

describe("isHeadCommit", () => {
	// Read from git's own %D decorations, so no extra command is needed to know
	// where the repo actually is.
	it("detects the attached HEAD's commit", () => {
		expect(isHeadCommit(["HEAD -> main", "origin/main"])).toBe(true)
	})

	it("detects a detached HEAD", () => {
		expect(isHeadCommit(["HEAD"])).toBe(true)
	})

	it("is false for commits that merely carry other refs", () => {
		expect(isHeadCommit(["origin/main", "tag: v1.0"])).toBe(false)
		expect(isHeadCommit([])).toBe(false)
	})

	// A branch literally named e.g. "HEADless" must not be mistaken for HEAD.
	it("does not match a branch whose name merely starts with HEAD", () => {
		expect(isHeadCommit(["HEADless"])).toBe(false)
	})
})

describe("headBranchName", () => {
	it("reads the branch HEAD is attached to", () => {
		expect(headBranchName(["HEAD -> main", "origin/main"])).toBe("main")
	})

	// Detached HEAD has no branch to name; callers show the short hash instead.
	it("is null for a detached HEAD", () => {
		expect(headBranchName(["HEAD"])).toBeNull()
	})

	it("is null for commits that aren't HEAD", () => {
		expect(headBranchName(["origin/main", "tag: v1.0"])).toBeNull()
		expect(headBranchName([])).toBeNull()
	})

	// A remote-tracking ref on the same commit must not be mistaken for the
	// checked-out branch.
	it("prefers the local branch over other refs on the same commit", () => {
		expect(headBranchName(["origin/main", "HEAD -> feature"])).toBe("feature")
	})
})
