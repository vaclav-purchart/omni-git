import { useCallback, useEffect, useRef, useState } from "react"
import { type CommitSummary, commands } from "../ipc/bindings"

export function useCommits(repoPath: string, all: boolean, pageSize: number) {
	const [commits, setCommits] = useState<CommitSummary[]>([])
	const [loading, setLoading] = useState(false)
	const [reachedEnd, setReachedEnd] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const skipRef = useRef(0)
	const genRef = useRef(0)
	// Synchronous guard against double-fires: setLoading(true) is async, so two
	// near-simultaneous loadMore calls can both observe the stale `loading`
	// state and both fetch the same skipRef page, appending duplicates. A ref
	// is updated synchronously and closes that window.
	const loadingRef = useRef(false)

	const loadMore = useCallback(async () => {
		if (loadingRef.current || reachedEnd) {
			return
		}
		loadingRef.current = true
		setLoading(true)
		const gen = genRef.current
		const result = await commands.logCommits(
			repoPath,
			all,
			skipRef.current,
			pageSize,
		)
		if (genRef.current !== gen) {
			// A repo switch superseded this request while it was in flight;
			// discard the stale result instead of contaminating the new
			// repo's state. The new generation's own loadMore call manages
			// its own loading state, so we must not touch it here.
			loadingRef.current = false
			return
		}
		if (result.status === "ok") {
			const page = result.data
			skipRef.current += page.length
			setCommits((prev) => [...prev, ...page])
			if (page.length < pageSize) {
				setReachedEnd(true)
			}
		} else {
			setError(
				"NonZero" in result.error
					? result.error.NonZero.stderr
					: "Failed to read history",
			)
			setReachedEnd(true)
		}
		setLoading(false)
		loadingRef.current = false
	}, [repoPath, all, pageSize, reachedEnd])

	/// Re-reads the pages already on screen and swaps them in atomically.
	///
	/// Deliberately does NOT clear `commits` first: this runs after every
	/// mutation and on every watcher event, and emptying the list would blank the
	/// railway for a frame — the "whole UI blinks twice" symptom. The old rows
	/// stay on screen until the new ones are ready, so an unchanged history
	/// produces no visible change at all.
	const reload = useCallback(async () => {
		const gen = genRef.current
		// Ask for as much as we'd already paged in, so a reload can't silently
		// shrink the list under a user who had scrolled far back.
		const want = Math.max(skipRef.current, pageSize)
		const result = await commands.logCommits(repoPath, all, 0, want)
		if (genRef.current !== gen || result.status !== "ok") {
			return
		}
		const page = result.data
		skipRef.current = page.length
		setCommits(page)
		setReachedEnd(page.length < want)
		setError(null)
	}, [repoPath, all, pageSize])

	// Reset and load the first page whenever the repo or all changes.
	// Canonical reset-on-change: reload commits when the repo or all changes. (CommitRailway is also keyed on all, which remounts us — this effect remains the intended reset mechanism; do not remove it if that key is ever dropped.)
	useEffect(() => {
		genRef.current += 1
		setCommits([])
		setReachedEnd(false)
		setError(null)
		setLoading(false)
		loadingRef.current = false
		skipRef.current = 0
	}, [repoPath, all])

	useEffect(() => {
		if (commits.length === 0 && !reachedEnd && !loading && error === null) {
			loadMore()
		}
	}, [commits.length, reachedEnd, loading, error, loadMore])

	return { commits, loadMore, reload, loading, reachedEnd, error }
}
