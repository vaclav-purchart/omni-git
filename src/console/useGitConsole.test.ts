import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { GitConsoleEntry } from "../ipc/bindings"
import { useGitConsole } from "./useGitConsole"

const { recentConsoleEntries, listen } = vi.hoisted(() => ({
	recentConsoleEntries: vi.fn(),
	listen: vi.fn(),
}))

vi.mock("../ipc/bindings", () => ({
	commands: {
		recentConsoleEntries,
	},
	events: {
		gitConsoleEntry: { listen },
	},
}))

function makeEntry(id: string, timestamp_ms: number): GitConsoleEntry {
	return {
		id,
		command: `git cmd-${id}`,
		exit_code: 0,
		duration_ms: 1,
		stderr: "",
		timestamp_ms,
	}
}

describe("useGitConsole", () => {
	it("seeds entries from the recent console buffer on mount", async () => {
		const seed = [makeEntry("1", 1000), makeEntry("2", 2000)]
		recentConsoleEntries.mockResolvedValue(seed)
		listen.mockResolvedValue(() => {})

		const { result } = renderHook(() => useGitConsole(500))

		await waitFor(() => {
			expect(result.current.entries).toEqual(seed)
		})
	})

	it("does not double-add a live entry that duplicates a seeded id", async () => {
		const seed = [makeEntry("1", 1000)]
		recentConsoleEntries.mockResolvedValue(seed)

		let liveHandler: ((event: { payload: GitConsoleEntry }) => void) | null =
			null
		listen.mockImplementation((handler) => {
			liveHandler = handler
			return Promise.resolve(() => {})
		})

		const { result } = renderHook(() => useGitConsole(500))

		await waitFor(() => {
			expect(result.current.entries).toEqual(seed)
		})

		act(() => {
			liveHandler?.({ payload: makeEntry("1", 1000) })
		})

		expect(result.current.entries).toEqual(seed)

		act(() => {
			liveHandler?.({ payload: makeEntry("2", 3000) })
		})

		expect(result.current.entries).toEqual([...seed, makeEntry("2", 3000)])
	})

	it("merges the seed instead of clobbering a live entry that arrived first", async () => {
		const seed = [makeEntry("1", 1000), makeEntry("2", 2000)]

		let resolveSeed: (value: GitConsoleEntry[]) => void = () => {}
		recentConsoleEntries.mockReturnValue(
			new Promise<GitConsoleEntry[]>((resolve) => {
				resolveSeed = resolve
			}),
		)

		let liveHandler: ((event: { payload: GitConsoleEntry }) => void) | null =
			null
		listen.mockImplementation((handler) => {
			liveHandler = handler
			return Promise.resolve(() => {})
		})

		const { result } = renderHook(() => useGitConsole(500))

		// Live events arrive before the seed fetch resolves: one entry not in
		// the seed at all, plus one that duplicates a seed id (stale payload).
		act(() => {
			liveHandler?.({ payload: makeEntry("3", 500) })
			liveHandler?.({ payload: makeEntry("1", 999) })
		})

		expect(result.current.entries.map((entry) => entry.id)).toEqual(["3", "1"])

		act(() => {
			resolveSeed(seed)
		})

		await waitFor(() => {
			expect(result.current.entries).toEqual([...seed, makeEntry("3", 500)])
		})

		const ids = result.current.entries.map((entry) => entry.id)
		expect(new Set(ids).size).toBe(ids.length)
	})
})
