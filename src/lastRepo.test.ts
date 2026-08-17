import { beforeEach, describe, expect, it } from "vitest"
import {
	clearLastRepo,
	parseLastRepo,
	readLastRepo,
	writeLastRepo,
} from "./lastRepo"
import { __resetSettingsForTests as resetSettings } from "./settings/settings"

const REPO = { id: "1", name: "omni-git", path: "/code/omni-git" }

beforeEach(() => {
	resetSettings()
})

describe("parseLastRepo", () => {
	// The whole record is stored so the workspace can render on the first paint,
	// with no lookup to wait for.
	it("reads a full repo record", () => {
		expect(parseLastRepo(JSON.stringify(REPO))).toEqual({
			kind: "repo",
			repo: REPO,
		})
	})

	// The old format was the id alone; those entries still need a lookup.
	it("reads the legacy id-only format", () => {
		expect(parseLastRepo(JSON.stringify("1"))).toEqual({ kind: "id", id: "1" })
	})

	it("is null when absent", () => {
		expect(parseLastRepo(null)).toBeNull()
	})

	it("is null for unparseable or empty values", () => {
		expect(parseLastRepo("{not json")).toBeNull()
		expect(parseLastRepo(JSON.stringify(""))).toBeNull()
		expect(parseLastRepo(JSON.stringify(null))).toBeNull()
	})

	// A partial record can't open a workspace, so treat it as absent rather than
	// rendering something half-broken.
	it("is null for a record missing any field", () => {
		expect(parseLastRepo(JSON.stringify({ id: "1", name: "x" }))).toBeNull()
		expect(parseLastRepo(JSON.stringify({ id: "1", path: "/x" }))).toBeNull()
		expect(parseLastRepo(JSON.stringify({ name: "x", path: "/x" }))).toBeNull()
		expect(
			parseLastRepo(JSON.stringify({ id: 1, name: "x", path: "/x" })),
		).toBeNull()
	})
})

describe("readLastRepo / writeLastRepo / clearLastRepo", () => {
	it("round-trips a repo", () => {
		writeLastRepo(REPO)

		expect(readLastRepo()).toEqual({ kind: "repo", repo: REPO })
	})

	it("clears", () => {
		writeLastRepo(REPO)
		clearLastRepo()

		expect(readLastRepo()).toBeNull()
	})

	it("reads null when nothing is stored", () => {
		expect(readLastRepo()).toBeNull()
	})
})
