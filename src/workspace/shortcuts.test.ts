import { describe, expect, it } from "vitest"
import {
	copyPathShortcutLabel,
	isCopyPathShortcut,
	isPaletteShortcut,
	isRefreshShortcut,
	refreshShortcutLabel,
	type ShortcutEvent,
} from "./shortcuts"

function key(code: string, mods: Partial<ShortcutEvent> = {}): ShortcutEvent {
	return {
		code,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...mods,
	}
}

describe("isRefreshShortcut", () => {
	it("matches Cmd+R and Ctrl+R", () => {
		expect(isRefreshShortcut(key("KeyR", { metaKey: true }))).toBe(true)
		expect(isRefreshShortcut(key("KeyR", { ctrlKey: true }))).toBe(true)
	})

	it("needs the modifier", () => {
		expect(isRefreshShortcut(key("KeyR"))).toBe(false)
	})

	// Kept distinct so Cmd+Shift+R (hard reload, by convention) and Alt variants
	// remain available for something else later.
	it("does not match when Shift or Alt is also held", () => {
		expect(
			isRefreshShortcut(key("KeyR", { metaKey: true, shiftKey: true })),
		).toBe(false)
		expect(
			isRefreshShortcut(key("KeyR", { metaKey: true, altKey: true })),
		).toBe(false)
	})

	it("does not match another key", () => {
		expect(isRefreshShortcut(key("KeyT", { metaKey: true }))).toBe(false)
	})

	// Matched on `code`, so a non-QWERTY layout where the R position produces a
	// different character still works.
	it("ignores the produced character", () => {
		expect(isRefreshShortcut(key("KeyR", { metaKey: true }))).toBe(true)
	})
})

describe("isPaletteShortcut", () => {
	it("matches Cmd/Ctrl+Shift+P", () => {
		expect(
			isPaletteShortcut(key("KeyP", { metaKey: true, shiftKey: true })),
		).toBe(true)
		expect(
			isPaletteShortcut(key("KeyP", { ctrlKey: true, shiftKey: true })),
		).toBe(true)
	})

	it("needs Shift", () => {
		expect(isPaletteShortcut(key("KeyP", { metaKey: true }))).toBe(false)
	})

	// The two shortcuts must not overlap.
	it("does not collide with refresh", () => {
		const refresh = key("KeyR", { metaKey: true })
		const palette = key("KeyP", { metaKey: true, shiftKey: true })

		expect(isPaletteShortcut(refresh)).toBe(false)
		expect(isRefreshShortcut(palette)).toBe(false)
	})
})

describe("refreshShortcutLabel", () => {
	it("uses the platform's notation", () => {
		expect(refreshShortcutLabel(true)).toBe("⌘R")
		expect(refreshShortcutLabel(false)).toBe("Ctrl+R")
	})
})

describe("isCopyPathShortcut", () => {
	it("matches Cmd+Shift+C and Ctrl+Shift+C", () => {
		expect(
			isCopyPathShortcut(key("KeyC", { metaKey: true, shiftKey: true })),
		).toBe(true)
		expect(
			isCopyPathShortcut(key("KeyC", { ctrlKey: true, shiftKey: true })),
		).toBe(true)
	})

	// Cmd/Ctrl+C has to stay the ordinary copy, or selecting a line in a diff and
	// copying it would stop working.
	it("does not match a plain Cmd+C", () => {
		expect(isCopyPathShortcut(key("KeyC", { metaKey: true }))).toBe(false)
	})

	it("needs the modifier", () => {
		expect(isCopyPathShortcut(key("KeyC", { shiftKey: true }))).toBe(false)
	})

	it("does not match when Alt is also held", () => {
		expect(
			isCopyPathShortcut(
				key("KeyC", { metaKey: true, shiftKey: true, altKey: true }),
			),
		).toBe(false)
	})

	// `code`, not `key`: with Shift held, `key` is "C" on a US layout and something
	// else again on others.
	it("matches on the physical key", () => {
		expect(
			isCopyPathShortcut(key("KeyV", { metaKey: true, shiftKey: true })),
		).toBe(false)
	})
})

describe("copyPathShortcutLabel", () => {
	it("uses mac symbols on mac and words elsewhere", () => {
		expect(copyPathShortcutLabel(true)).toBe("⌘⇧C")
		expect(copyPathShortcutLabel(false)).toBe("Ctrl+Shift+C")
	})
})
