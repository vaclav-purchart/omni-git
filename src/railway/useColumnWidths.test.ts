import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import {
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import { useColumnWidths } from "./useColumnWidths"

const KEY = "railway-cols"

describe("useColumnWidths", () => {
	beforeEach(() => {
		resetSettings()
	})

	it("loads defaults when nothing is stored", () => {
		const { result } = renderHook(() => useColumnWidths())
		expect(result.current.widths.author).toBe(150)
	})

	it("clamps setWidth to the column's MIN", () => {
		const { result } = renderHook(() => useColumnWidths())
		act(() => {
			result.current.setWidth("author", 5)
		})
		expect(result.current.widths.author).toBe(70)
	})

	it("clamps setWidth to MAX", () => {
		const { result } = renderHook(() => useColumnWidths())
		act(() => {
			result.current.setWidth("author", 9999)
		})
		expect(result.current.widths.author).toBe(400)
	})

	it("clamps/falls back on corrupt stored values", () => {
		setSetting(KEY, JSON.stringify({ author: -50, commit: "x", date: 88 }))
		const { result } = renderHook(() => useColumnWidths())
		expect(result.current.widths.author).toBe(70) // clamped to MIN
		expect(result.current.widths.commit).toBe(74) // non-number -> default
		expect(result.current.widths.date).toBe(88) // valid, unchanged
	})

	it("persist() writes the current widths to settings", () => {
		const { result } = renderHook(() => useColumnWidths())
		act(() => {
			result.current.setWidth("author", 200)
		})
		act(() => {
			result.current.persist()
		})

		const { result: reloaded } = renderHook(() => useColumnWidths())
		expect(reloaded.current.widths.author).toBe(200)
	})
})
