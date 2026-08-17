import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import {
	getSetting,
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import { useFileFilters } from "./useFileFilters"

const KEY = "file-filters"

describe("useFileFilters", () => {
	beforeEach(() => {
		resetSettings()
	})

	it("adds a filter and persists it to settings", () => {
		const { result } = renderHook(() => useFileFilters())

		act(() => {
			result.current.addFilter("*.test.*", "hide")
		})

		expect(result.current.filters).toHaveLength(1)
		expect(result.current.filters[0]).toMatchObject({
			pattern: "*.test.*",
			mode: "hide",
			enabled: true,
		})

		const stored = JSON.parse(getSetting(KEY) ?? "[]")
		expect(stored).toHaveLength(1)
		expect(stored[0].pattern).toBe("*.test.*")
	})

	it("does not add an empty or whitespace-only pattern", () => {
		const { result } = renderHook(() => useFileFilters())

		act(() => {
			result.current.addFilter("", "hide")
			result.current.addFilter("   ", "highlight")
		})

		expect(result.current.filters).toEqual([])
		expect(getSetting(KEY)).toBeNull()
	})

	it("setEnabled toggles the enabled flag and persists it", () => {
		const { result } = renderHook(() => useFileFilters())

		act(() => {
			result.current.addFilter("*.gen.ts", "hide")
		})
		const id = result.current.filters[0].id

		act(() => {
			result.current.setEnabled(id, false)
		})

		expect(result.current.filters[0].enabled).toBe(false)
		const stored = JSON.parse(getSetting(KEY) ?? "[]")
		expect(stored[0].enabled).toBe(false)
	})

	it("updateFilter patches fields and persists them", () => {
		const { result } = renderHook(() => useFileFilters())

		act(() => {
			result.current.addFilter("*.gen.ts", "hide")
		})
		const id = result.current.filters[0].id

		act(() => {
			result.current.updateFilter(id, { pattern: "*.gen.*", mode: "highlight" })
		})

		expect(result.current.filters[0]).toMatchObject({
			pattern: "*.gen.*",
			mode: "highlight",
		})
		const stored = JSON.parse(getSetting(KEY) ?? "[]")
		expect(stored[0]).toMatchObject({
			pattern: "*.gen.*",
			mode: "highlight",
		})
	})

	it("removeFilter deletes the filter and persists the removal", () => {
		const { result } = renderHook(() => useFileFilters())

		act(() => {
			result.current.addFilter("*.gen.ts", "hide")
		})
		const id = result.current.filters[0].id

		act(() => {
			result.current.removeFilter(id)
		})

		expect(result.current.filters).toEqual([])
		const stored = JSON.parse(getSetting(KEY) ?? "[]")
		expect(stored).toEqual([])
	})

	it("a fresh renderHook reads back what a previous instance persisted", () => {
		const first = renderHook(() => useFileFilters())

		act(() => {
			first.result.current.addFilter("*.test.*", "hide")
		})

		const second = renderHook(() => useFileFilters())
		expect(second.result.current.filters).toHaveLength(1)
		expect(second.result.current.filters[0]).toMatchObject({
			pattern: "*.test.*",
			mode: "hide",
		})
	})

	it("yields an empty array without throwing when stored value is not valid JSON", () => {
		setSetting(KEY, "not json")
		const { result } = renderHook(() => useFileFilters())
		expect(result.current.filters).toEqual([])
	})

	it("yields an empty array without throwing when stored value is JSON but not filter-shaped", () => {
		setSetting(KEY, '{"a":1}')
		const { result } = renderHook(() => useFileFilters())
		expect(result.current.filters).toEqual([])
	})
})
