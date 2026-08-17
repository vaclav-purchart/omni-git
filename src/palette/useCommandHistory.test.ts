import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import {
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import { useCommandHistory } from "./useCommandHistory"

beforeEach(() => {
	resetSettings()
})

describe("useCommandHistory", () => {
	it("starts empty and records newest first", () => {
		const { result } = renderHook(() => useCommandHistory("/repo"))
		expect(result.current.history).toEqual([])

		act(() => result.current.remember("git status"))
		act(() => result.current.remember("git fetch"))

		expect(result.current.history).toEqual(["git fetch", "git status"])
	})

	// Otherwise arrowing back walks over the same command repeatedly.
	it("moves a re-run command to the front instead of duplicating it", () => {
		const { result } = renderHook(() => useCommandHistory("/repo"))

		act(() => result.current.remember("git status"))
		act(() => result.current.remember("git fetch"))
		act(() => result.current.remember("git status"))

		expect(result.current.history).toEqual(["git status", "git fetch"])
	})

	it("ignores blank commands", () => {
		const { result } = renderHook(() => useCommandHistory("/repo"))

		act(() => result.current.remember("   "))

		expect(result.current.history).toEqual([])
	})

	it("trims what it stores", () => {
		const { result } = renderHook(() => useCommandHistory("/repo"))

		act(() => result.current.remember("  git status  "))

		expect(result.current.history).toEqual(["git status"])
	})

	it("survives a remount", () => {
		const first = renderHook(() => useCommandHistory("/repo"))
		act(() => first.result.current.remember("git status"))
		first.unmount()

		const second = renderHook(() => useCommandHistory("/repo"))

		expect(second.result.current.history).toEqual(["git status"])
	})

	// `checkout` targets are repo-specific, so one repo's history must not offer
	// commands that don't apply in another.
	it("keeps history separate per repo", () => {
		const a = renderHook(() => useCommandHistory("/repo-a"))
		act(() => a.result.current.remember("git checkout feature-a"))

		const b = renderHook(() => useCommandHistory("/repo-b"))

		expect(b.result.current.history).toEqual([])
	})

	it("caps the list", () => {
		const { result } = renderHook(() => useCommandHistory("/repo"))

		for (let i = 0; i < 60; i++) {
			act(() => result.current.remember(`git tag t${i}`))
		}

		expect(result.current.history.length).toBe(50)
		expect(result.current.history[0]).toBe("git tag t59")
	})

	// The value is persisted, so a stale or hand-edited payload must not crash.
	it("tolerates a corrupt stored value", () => {
		setSetting("command-history:/repo", '"not an array"')

		const { result } = renderHook(() => useCommandHistory("/repo"))

		expect(result.current.history).toEqual([])
		act(() => result.current.remember("git status"))
		expect(result.current.history).toEqual(["git status"])
	})
})
