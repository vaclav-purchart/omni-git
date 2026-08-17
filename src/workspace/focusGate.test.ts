import { describe, expect, it } from "vitest"
import {
	type FocusGate,
	initialFocusGate,
	onFocusChange,
	onRepoChanged,
} from "./focusGate"

describe("focusGate", () => {
	it("refreshes immediately when a change arrives while focused", () => {
		const { refreshNow, gate } = onRepoChanged({
			focused: true,
			pending: false,
		})
		expect(refreshNow).toBe(true)
		expect(gate).toEqual({ focused: true, pending: false })
	})

	it("defers (marks pending) when a change arrives while unfocused", () => {
		const { refreshNow, gate } = onRepoChanged({
			focused: false,
			pending: false,
		})
		expect(refreshNow).toBe(false)
		expect(gate).toEqual({ focused: false, pending: true })
	})

	it("does not refresh on losing focus", () => {
		const { refreshNow, gate } = onFocusChange(initialFocusGate, false)
		expect(refreshNow).toBe(false)
		expect(gate).toEqual({ focused: false, pending: false })
	})

	it("catches up once when focus returns with a pending change", () => {
		const { refreshNow, gate } = onFocusChange(
			{ focused: false, pending: true },
			true,
		)
		expect(refreshNow).toBe(true)
		expect(gate).toEqual({ focused: true, pending: false })
	})

	// Refreshes even with nothing deferred: the watcher only sees `.git`, so a
	// plain editor save produces NO event and the working view would stay stale
	// until the user pressed ↻. Returning to the window is when they expect
	// current data.
	it("refreshes on regaining focus even when nothing was deferred", () => {
		const { refreshNow, gate } = onFocusChange(
			{ focused: false, pending: false },
			true,
		)
		expect(refreshNow).toBe(true)
		expect(gate).toEqual({ focused: true, pending: false })
	})

	// A "focused" event arrives when the window is first shown; acting on it would
	// duplicate the initial load.
	it("ignores a focus event when already focused", () => {
		const { refreshNow, gate } = onFocusChange(
			{ focused: true, pending: false },
			true,
		)
		expect(refreshNow).toBe(false)
		expect(gate).toEqual({ focused: true, pending: false })
	})

	it("end-to-end: blur, change while away, then focus → exactly one catch-up", () => {
		let gate: FocusGate = initialFocusGate

		// Window loses focus.
		let d = onFocusChange(gate, false)
		gate = d.gate
		expect(d.refreshNow).toBe(false)

		// Two changes happen while away — both deferred, still just one pending.
		d = onRepoChanged(gate)
		gate = d.gate
		expect(d.refreshNow).toBe(false)
		d = onRepoChanged(gate)
		gate = d.gate
		expect(d.refreshNow).toBe(false)
		expect(gate.pending).toBe(true)

		// Focus returns → one catch-up refresh, flag cleared.
		d = onFocusChange(gate, true)
		gate = d.gate
		expect(d.refreshNow).toBe(true)
		expect(gate).toEqual({ focused: true, pending: false })

		// A subsequent change while focused refreshes immediately again.
		d = onRepoChanged(gate)
		expect(d.refreshNow).toBe(true)
	})
})
