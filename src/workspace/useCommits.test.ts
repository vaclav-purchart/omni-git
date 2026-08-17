import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { CommitSummary } from "../ipc/bindings"
import { useCommits } from "./useCommits"

const { logCommits } = vi.hoisted(() => ({
	logCommits: vi.fn(),
}))

vi.mock("../ipc/bindings", () => ({
	commands: {
		logCommits,
	},
}))

function makeCommit(hash: string): CommitSummary {
	return {
		hash,
		parents: [],
		author_name: "Test",
		author_email: "test@example.com",
		timestamp_ms: 0,
		refs: [],
		subject: hash,
	}
}

describe("useCommits", () => {
	it("discards a stale in-flight result from a repo that was switched away from", async () => {
		let resolveA: (value: { status: "ok"; data: CommitSummary[] }) => void =
			() => {}
		const pendingA = new Promise<{ status: "ok"; data: CommitSummary[] }>(
			(resolve) => {
				resolveA = resolve
			},
		)

		logCommits.mockImplementationOnce(() => pendingA)
		logCommits.mockImplementation(() =>
			Promise.resolve({ status: "ok", data: [makeCommit("B1")] }),
		)

		const { result, rerender } = renderHook(
			({ repoPath }) => useCommits(repoPath, true, 50),
			{ initialProps: { repoPath: "/repo/A" } },
		)

		// First call (for repo A) has been kicked off and is pending.
		expect(logCommits).toHaveBeenCalledTimes(1)

		// Switch to repo B before A's request resolves.
		rerender({ repoPath: "/repo/B" })

		// Repo B's request should complete and populate commits.
		await waitFor(() => {
			expect(result.current.commits).toEqual([makeCommit("B1")])
		})

		// Now resolve the stale repo A request.
		await act(async () => {
			resolveA({ status: "ok", data: [makeCommit("A1")] })
		})

		// The stale A result must not have contaminated the current state.
		expect(result.current.commits).toEqual([makeCommit("B1")])
		expect(result.current.commits.some((c) => c.hash === "A1")).toBe(false)
		expect(result.current.loading).toBe(false)
	})
})

describe("useCommits reload", () => {
	// THE no-blink invariant: reload must never empty the list. It runs after
	// every mutation and on every watcher event, and a momentarily empty
	// `commits` blanks the railway for a frame — which is what made the whole
	// window appear to flash.
	it("keeps the current commits on screen while re-reading", async () => {
		logCommits.mockResolvedValueOnce({
			status: "ok",
			data: [makeCommit("A"), makeCommit("B")],
		})
		const { result } = renderHook(() => useCommits("/repo", true, 50))
		await waitFor(() => expect(result.current.commits).toHaveLength(2))

		let resolveReload: (v: unknown) => void = () => {}
		logCommits.mockReturnValueOnce(
			new Promise((res) => {
				resolveReload = res
			}),
		)
		let reloading: Promise<void> = Promise.resolve()
		act(() => {
			reloading = result.current.reload()
		})

		// Mid-flight: the old rows are still there.
		expect(result.current.commits.map((c) => c.hash)).toEqual(["A", "B"])

		await act(async () => {
			resolveReload({
				status: "ok",
				data: [makeCommit("C"), makeCommit("A"), makeCommit("B")],
			})
			await reloading
		})

		// Swapped atomically, in git's newest-first order — the new commit on top.
		expect(result.current.commits.map((c) => c.hash)).toEqual(["C", "A", "B"])
	})

	// A reload must not silently shrink the history under a user who paged back.
	it("re-reads as many commits as were already loaded", async () => {
		logCommits.mockResolvedValueOnce({
			status: "ok",
			data: Array.from({ length: 50 }, (_, i) => makeCommit(`p1-${i}`)),
		})
		const { result } = renderHook(() => useCommits("/repo", true, 50))
		await waitFor(() => expect(result.current.commits).toHaveLength(50))

		logCommits.mockResolvedValueOnce({
			status: "ok",
			data: Array.from({ length: 50 }, (_, i) => makeCommit(`p2-${i}`)),
		})
		await act(async () => {
			await result.current.loadMore()
		})
		expect(result.current.commits).toHaveLength(100)

		logCommits.mockResolvedValueOnce({
			status: "ok",
			data: Array.from({ length: 100 }, (_, i) => makeCommit(`r-${i}`)),
		})
		await act(async () => {
			await result.current.reload()
		})

		expect(logCommits).toHaveBeenLastCalledWith("/repo", true, 0, 100)
		expect(result.current.commits).toHaveLength(100)
	})

	// A failed reload must leave what's on screen alone rather than wiping it.
	it("keeps the existing commits when the reload fails", async () => {
		logCommits.mockResolvedValueOnce({
			status: "ok",
			data: [makeCommit("A")],
		})
		const { result } = renderHook(() => useCommits("/repo", true, 50))
		await waitFor(() => expect(result.current.commits).toHaveLength(1))

		logCommits.mockResolvedValueOnce({
			status: "error",
			error: { NonZero: { code: 1, stderr: "boom" } },
		})
		await act(async () => {
			await result.current.reload()
		})

		expect(result.current.commits.map((c) => c.hash)).toEqual(["A"])
	})
})
