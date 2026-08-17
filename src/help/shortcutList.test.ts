import { describe, expect, it } from "vitest"
import {
	formatKeys,
	groupShortcuts,
	matchesShortcut,
	SHORTCUTS,
} from "./shortcutList"

describe("SHORTCUTS", () => {
	it("has entries, each fully filled in", () => {
		expect(SHORTCUTS.length).toBeGreaterThan(10)
		for (const s of SHORTCUTS) {
			expect(s.keys.trim()).not.toBe("")
			expect(s.description.trim()).not.toBe("")
			expect(s.context.trim()).not.toBe("")
		}
	})

	// The list is hand-written, so guard the mistake that costs the most: two
	// entries claiming the same chord in the same context.
	it("has no duplicate keys within a context", () => {
		const seen = new Set<string>()
		const dupes: string[] = []
		for (const s of SHORTCUTS) {
			const id = `${s.context}:${s.keys}:${s.description}`
			if (seen.has(id)) {
				dupes.push(id)
			}
			seen.add(id)
		}
		expect(dupes).toEqual([])
	})

	// These two are implemented in workspace/shortcuts.ts; if they're renamed or
	// removed there, the help panel would keep advertising them.
	it("documents the global shortcuts", () => {
		const global = SHORTCUTS.filter((s) => s.context === "Global").map(
			(s) => s.keys,
		)

		expect(global).toContain("⌘R")
		expect(global).toContain("⌘⇧P")
	})
})

describe("formatKeys", () => {
	it("leaves mac notation alone", () => {
		expect(formatKeys("⌘⇧P", true)).toBe("⌘⇧P")
	})

	it("spells out modifiers elsewhere", () => {
		expect(formatKeys("⌘R", false)).toBe("Ctrl+R")
		expect(formatKeys("⌘⇧P", false)).toBe("Ctrl+Shift+P")
	})

	it("leaves plain keys untouched on both", () => {
		expect(formatKeys("Backspace", false)).toBe("Backspace")
		expect(formatKeys("↑ ↓", true)).toBe("↑ ↓")
	})
})

describe("matchesShortcut", () => {
	const s = {
		keys: "⌘R",
		description: "Refresh the repository",
		context: "Global",
	}

	it("matches everything on an empty query", () => {
		expect(matchesShortcut(s, "")).toBe(true)
		expect(matchesShortcut(s, "   ")).toBe(true)
	})

	it("matches description, context and keys, case-insensitively", () => {
		expect(matchesShortcut(s, "refresh")).toBe(true)
		expect(matchesShortcut(s, "REPOSITORY")).toBe(true)
		expect(matchesShortcut(s, "global")).toBe(true)
		expect(matchesShortcut(s, "⌘R")).toBe(true)
	})

	it("rejects a non-match", () => {
		expect(matchesShortcut(s, "zzz")).toBe(false)
	})
})

describe("groupShortcuts", () => {
	it("groups by context, preserving list order", () => {
		const groups = groupShortcuts("", true)

		expect(groups[0].context).toBe("Global")
		expect(groups.map((g) => g.context)).toEqual([
			...new Set(SHORTCUTS.map((s) => s.context)),
		])
	})

	it("filters, dropping contexts with no matches", () => {
		const groups = groupShortcuts("refresh", true)

		expect(groups).toHaveLength(1)
		expect(groups[0].context).toBe("Global")
		expect(groups[0].items).toHaveLength(1)
	})

	// Searching the DISPLAYED keys is the point: a Windows user types "ctrl",
	// which appears nowhere in the source list.
	it("searches the platform-formatted keys", () => {
		expect(groupShortcuts("ctrl", false).length).toBeGreaterThan(0)
		expect(groupShortcuts("ctrl", true)).toEqual([])
	})

	it("returns formatted keys, not the raw mac notation", () => {
		const groups = groupShortcuts("refresh", false)

		expect(groups[0].items[0].keys).toBe("Ctrl+R")
	})

	it("returns nothing when nothing matches", () => {
		expect(groupShortcuts("zzzzz", true)).toEqual([])
	})
})
