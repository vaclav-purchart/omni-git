import {
	CheckCircle,
	CircleNotch,
	WarningCircle,
	X,
} from "@phosphor-icons/react"
import { useEffect, useRef } from "react"
import "./CommandOutput.css"

export type CommandResult = {
	title: string
	output: string
	status: "running" | "ok" | "error"
}

/** Treat "within this many px of the bottom" as following the tail. */
const TAIL_SLACK_PX = 24

/**
 * Shows a git command's output in the right-hand panel, in place of the diff,
 * live as it streams.
 *
 * Stays until dismissed (Escape or the close button), success included. It used
 * to close itself after a few seconds on success, which meant output vanished
 * while being read — and a command's result is worth keeping around until the
 * user is done with it, not until a timer says so.
 *
 * Lives here rather than inside the panel that triggered the command on
 * purpose: `WorkingCopyDetail` is keyed on `refreshKey`, and a hook that touches
 * `.git` (lint-staged stashes; `git commit` itself writes COMMIT_EDITMSG) trips
 * the FS watcher → refresh → remount. Output rendered inside that subtree
 * flashed for ~200ms and vanished before it could be read.
 */
export function CommandOutput({
	result,
	onClose,
}: {
	result: CommandResult
	onClose: () => void
}) {
	const bodyRef = useRef<HTMLPreElement>(null)
	const onCloseRef = useRef(onClose)
	useEffect(() => {
		onCloseRef.current = onClose
	}, [onClose])

	// Escape dismisses the panel. `defaultPrevented` lets anything nearer the
	// user claim the key first — the recall list, a context menu, a confirm
	// dialog — so Escape closes the innermost thing, not this.
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape" && !e.defaultPrevented) {
				onCloseRef.current()
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [])

	// Follow the tail as output streams in, but only while the user is already
	// at the bottom — otherwise scrolling up to read something would be
	// yanked back by the next chunk.
	useEffect(() => {
		const el = bodyRef.current
		if (el === null) {
			return
		}
		const atBottom =
			el.scrollHeight - el.scrollTop - el.clientHeight <= TAIL_SLACK_PX
		if (atBottom) {
			el.scrollTop = el.scrollHeight
		}
	}, [result.output])

	const running = result.status === "running"

	return (
		<div className={`cmdout is-${result.status}`}>
			<div className="cmdout-header">
				{/* Larger than the surrounding 1em text: this icon is the fastest
				    signal of what state the command is in. */}
				{running ? (
					<CircleNotch className="cmdout-icon cmdout-spin" />
				) : result.status === "ok" ? (
					<CheckCircle className="cmdout-icon" />
				) : (
					<WarningCircle className="cmdout-icon" />
				)}
				<span className="cmdout-title">{result.title}</span>
				<button
					type="button"
					className="cmdout-close"
					title="Close"
					aria-label="Close output"
					onClick={onClose}
				>
					<X />
				</button>
			</div>
			{/* Selectable so error text can be copied out; `pre` keeps the
			    command's own alignment (hook output is often columnar). */}
			<pre ref={bodyRef} className="cmdout-body" aria-label="Command output">
				{result.output === ""
					? running
						? "Waiting for output…"
						: result.status === "ok"
							? "Done."
							: "The command failed without producing any output."
					: result.output}
			</pre>
		</div>
	)
}
