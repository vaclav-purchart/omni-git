import { describe, expect, it } from "vitest"
import {
	initialSelfChange,
	isSelfChangeEcho,
	markSelfChange,
	SELF_CHANGE_WINDOW_MS,
} from "./selfChange"

describe("selfChange", () => {
	it("treats nothing as an echo before any local change", () => {
		expect(isSelfChangeEcho(initialSelfChange, 1000)).toBe(false)
	})

	// The case it exists for: our own mutation writes `.git`, the debounced
	// watcher reports it back, and we'd otherwise re-read everything a second
	// time for data the mutation's own reload already fetched.
	it("suppresses a watcher event arriving just after our own change", () => {
		const state = markSelfChange(1000)

		expect(isSelfChangeEcho(state, 1000)).toBe(true)
		expect(isSelfChangeEcho(state, 1400)).toBe(true)
	})

	it("stops suppressing once the window has passed", () => {
		const state = markSelfChange(1000)

		expect(isSelfChangeEcho(state, 1000 + SELF_CHANGE_WINDOW_MS)).toBe(false)
		expect(isSelfChangeEcho(state, 9000)).toBe(false)
	})

	// The window must comfortably outlast the watcher's 400ms debounce, or the
	// echo lands after it closed and we do the redundant reload anyway.
	it("outlasts the watcher debounce", () => {
		expect(SELF_CHANGE_WINDOW_MS).toBeGreaterThan(400)
	})

	it("re-marking extends the window from the later change", () => {
		const first = markSelfChange(1000)
		const second = markSelfChange(1500)

		expect(isSelfChangeEcho(first, 1800)).toBe(false)
		expect(isSelfChangeEcho(second, 1800)).toBe(true)
	})
})
