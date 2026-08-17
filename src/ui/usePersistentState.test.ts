import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import {
	getSetting,
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import { usePersistentState } from "./usePersistentState"

describe("usePersistentState", () => {
	beforeEach(() => {
		resetSettings()
	})

	it("returns the initial default when nothing is stored", () => {
		const { result } = renderHook(() => usePersistentState("x", "default"))
		expect(result.current[0]).toBe("default")
	})

	it("persists the raw JSON value to settings under the key on set", () => {
		const { result } = renderHook(() => usePersistentState("x", "default"))
		act(() => {
			result.current[1]("updated")
		})
		expect(result.current[0]).toBe("updated")
		expect(getSetting("x")).toBe(JSON.stringify("updated"))
	})

	it("supports a functional updater", () => {
		const { result } = renderHook(() => usePersistentState("count", 1))
		act(() => {
			result.current[1]((prev) => prev + 1)
		})
		expect(result.current[0]).toBe(2)
		expect(getSetting("count")).toBe(JSON.stringify(2))
	})

	it("reads back the persisted value in a fresh renderHook with the same key", () => {
		const first = renderHook(() => usePersistentState("x", "default"))
		act(() => {
			first.result.current[1]("persisted")
		})

		const second = renderHook(() => usePersistentState("x", "default"))
		expect(second.result.current[0]).toBe("persisted")
	})

	it("falls back to the default without throwing when the stored value is corrupt", () => {
		setSetting("x", "{bad")
		expect(() =>
			renderHook(() => usePersistentState("x", "default")),
		).not.toThrow()
		const { result } = renderHook(() => usePersistentState("x", "default"))
		expect(result.current[0]).toBe("default")
	})
})
