import { describe, expect, it } from "vitest"
import {
	rowsToKeys,
	selectionActions,
	selectionBySection,
	selectionSize,
	toggleRow,
} from "./fileSelection"

const SECTIONS = [
	{ key: "Staged" as const, paths: ["a.ts", "b.ts"] },
	{ key: "Unstaged" as const, paths: ["c.ts", "d.ts"] },
	{ key: "Untracked" as const, paths: ["e.ts"] },
]

describe("selectionBySection", () => {
	it("splits keys back into their sections", () => {
		const by = selectionBySection(
			new Set(["Staged:a.ts", "Unstaged:d.ts", "Untracked:e.ts"]),
			SECTIONS,
		)

		expect(by).toEqual({
			Staged: ["a.ts"],
			Unstaged: ["d.ts"],
			Untracked: ["e.ts"],
		})
	})

	// The same path can legitimately be in two sections at once — a file with both
	// staged and unstaged changes — so the section is part of the identity.
	it("keeps one path in two sections apart", () => {
		const by = selectionBySection(new Set(["Staged:a.ts"]), [
			{ key: "Staged", paths: ["a.ts"] },
			{ key: "Unstaged", paths: ["a.ts"] },
			{ key: "Untracked", paths: [] },
		])

		expect(by.Staged).toEqual(["a.ts"])
		expect(by.Unstaged).toEqual([])
	})

	// A selection survives the reload after a mutation, and staging MOVES a path
	// to another section. Acting on the stale key would ask git to unstage
	// something that is no longer staged.
	it("drops keys for rows that no longer exist", () => {
		const by = selectionBySection(
			new Set(["Unstaged:c.ts", "Unstaged:gone.ts"]),
			SECTIONS,
		)

		expect(by.Unstaged).toEqual(["c.ts"])
	})

	it("returns display order, not the order rows were picked", () => {
		const by = selectionBySection(
			new Set(["Staged:b.ts", "Staged:a.ts"]),
			SECTIONS,
		)

		expect(by.Staged).toEqual(["a.ts", "b.ts"])
	})

	it("is empty for an empty selection", () => {
		expect(selectionSize(selectionBySection(new Set(), SECTIONS))).toBe(0)
	})
})

describe("selectionActions", () => {
	// git add handles a modified tracked file and a brand-new one identically, so
	// a mixed selection is one command, not two.
	it("stages unstaged and untracked together", () => {
		const actions = selectionActions({
			Staged: [],
			Unstaged: ["c.ts"],
			Untracked: ["e.ts"],
		})

		expect(actions.stage).toEqual(["c.ts", "e.ts"])
	})

	// An untracked file has no committed version to restore, so discarding it is
	// deletion — a different, harsher action that must not hide behind "Discard".
	it("separates discarding tracked edits from deleting untracked files", () => {
		const actions = selectionActions({
			Staged: [],
			Unstaged: ["c.ts"],
			Untracked: ["e.ts"],
		})

		expect(actions.discard).toEqual(["c.ts"])
		expect(actions.remove).toEqual(["e.ts"])
	})

	it("offers nothing for an empty selection", () => {
		const actions = selectionActions({
			Staged: [],
			Unstaged: [],
			Untracked: [],
		})

		expect(actions.stage).toEqual([])
		expect(actions.unstage).toEqual([])
		expect(actions.discard).toEqual([])
		expect(actions.remove).toEqual([])
	})

	it("offers both directions when the selection spans staged and unstaged", () => {
		const actions = selectionActions({
			Staged: ["a.ts"],
			Unstaged: ["c.ts"],
			Untracked: [],
		})

		expect(actions.stage).toEqual(["c.ts"])
		expect(actions.unstage).toEqual(["a.ts"])
	})
})

describe("toggleRow", () => {
	it("adds a row that isn't selected", () => {
		expect(toggleRow(new Set(), "Unstaged", "c.ts")).toEqual(
			new Set(["Unstaged:c.ts"]),
		)
	})

	it("removes one that is", () => {
		expect(toggleRow(new Set(["Unstaged:c.ts"]), "Unstaged", "c.ts")).toEqual(
			new Set(),
		)
	})

	it("does not mutate the set it was given", () => {
		const original = new Set(["Unstaged:c.ts"])

		toggleRow(original, "Unstaged", "d.ts")

		expect(original).toEqual(new Set(["Unstaged:c.ts"]))
	})
})

describe("rowsToKeys", () => {
	it("keys a range by section and path", () => {
		expect(
			rowsToKeys([
				{ section: "Unstaged", path: "c.ts" },
				{ section: "Untracked", path: "e.ts" },
			]),
		).toEqual(new Set(["Unstaged:c.ts", "Untracked:e.ts"]))
	})
})
