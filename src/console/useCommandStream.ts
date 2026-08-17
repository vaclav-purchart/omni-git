import { useCallback, useEffect, useRef, useState } from "react"
import { events } from "../ipc/bindings"
import type { CommandResult } from "./CommandOutput"

/** Titles for a run's three states, chosen when the run starts. */
export type RunLabels = { running: string; ok: string; error: string }

function newRunId(): string {
	return crypto.randomUUID?.() ?? `run-${Date.now()}-${Math.random()}`
}

/**
 * Owns the live output of the current git run.
 *
 * Must be used ABOVE anything that remounts: the working panel is keyed on
 * `refreshKey`, and a hook that stashes (lint-staged does) trips the FS watcher
 * mid-command. Both listeners attach on mount and stay attached, so no chunk can
 * be missed in the gap between starting a command and subscribing to it.
 *
 * The panel is finalised from the `commandDone` event rather than the command's
 * return value, so it resolves correctly even if the component that started the
 * run is long gone.
 */
export function useCommandStream() {
	const [result, setResult] = useState<CommandResult | null>(null)
	// The run we're currently displaying. Chunks from any other run are ignored,
	// so a slow earlier command can't bleed into the current output.
	const runIdRef = useRef<string | null>(null)
	const labelsRef = useRef<RunLabels | null>(null)
	// Mirrored so `closeIfFinished` can consult the status synchronously from a
	// callback whose identity must stay stable.
	const resultRef = useRef<CommandResult | null>(null)
	useEffect(() => {
		resultRef.current = result
	}, [result])

	useEffect(() => {
		let cancelled = false
		const unlisteners: Array<() => void> = []
		const track = (p: Promise<() => void>) => {
			p.then((fn) => {
				if (cancelled) {
					fn()
				} else {
					unlisteners.push(fn)
				}
			})
		}

		track(
			events.commandChunk.listen((e) => {
				if (e.payload.run_id !== runIdRef.current) {
					return
				}
				setResult((r) =>
					r === null ? r : { ...r, output: r.output + e.payload.text },
				)
			}),
		)
		track(
			events.commandDone.listen((e) => {
				if (e.payload.run_id !== runIdRef.current) {
					return
				}
				const ok = e.payload.exit_code === 0
				const labels = labelsRef.current
				setResult((r) =>
					r === null
						? r
						: {
								...r,
								status: ok ? "ok" : "error",
								title: labels ? (ok ? labels.ok : labels.error) : r.title,
							},
				)
			}),
		)

		return () => {
			cancelled = true
			for (const fn of unlisteners) {
				fn()
			}
		}
	}, [])

	/** Starts displaying a new run. Returns the id to hand to the command. */
	const begin = useCallback((labels: RunLabels) => {
		const runId = newRunId()
		runIdRef.current = runId
		labelsRef.current = labels
		setResult({ title: labels.running, output: "", status: "running" })
		return runId
	}, [])

	/** Shows a result that never streamed — e.g. git couldn't be spawned. */
	const show = useCallback((r: CommandResult) => {
		runIdRef.current = null
		labelsRef.current = null
		setResult(r)
	}, [])

	const close = useCallback(() => {
		runIdRef.current = null
		labelsRef.current = null
		setResult(null)
	}, [])

	/**
	 * Dismisses FINISHED output, for when the user navigates somewhere that wants
	 * the panel back — clicking a file, a commit, a branch.
	 *
	 * A still-running command is left alone: it's producing output, and hiding a
	 * live process because a row was clicked would lose sight of it. Escape and the
	 * close button still work on those.
	 */
	const closeIfFinished = useCallback(() => {
		if (resultRef.current !== null && resultRef.current.status !== "running") {
			close()
		}
	}, [close])

	return { result, begin, show, close, closeIfFinished }
}
