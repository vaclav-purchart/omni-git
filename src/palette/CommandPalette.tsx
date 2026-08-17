import { Terminal } from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
	applyCompletion,
	completionCandidates,
	completionContext,
	longestCommonPrefix,
} from "./completion"
import "./CommandPalette.css"
import { NO_AUTOCORRECT } from "../ui/textInput"

const MAX_VISIBLE_CANDIDATES = 8

/**
 * VS Code-style command row for running a git command directly.
 *
 * Deliberately dumb about git: it hands the raw string to the backend, which
 * tokenises it (see `git::palette`). Nothing here decides what may run.
 */
export function CommandPalette({
	refs,
	history,
	onRun,
	onClose,
}: {
	/** Branch/tag names offered as argument completions. */
	refs: string[]
	/** Previously run commands, newest first. */
	history: string[]
	onRun: (input: string) => void
	onClose: () => void
}) {
	const [input, setInput] = useState("")
	// -1 = the line being typed; 0.. = an entry from history.
	const [historyPos, setHistoryPos] = useState(-1)
	// An in-progress Tab cycle. The ORIGINAL word start and candidate list have
	// to be remembered: once a candidate is inserted the word under the caret has
	// changed, so re-deriving candidates would complete the inserted value
	// instead of continuing to offer the alternatives.
	const [cycle, setCycle] = useState<{
		start: number
		candidates: string[]
		pos: number
	} | null>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	const ctx = useMemo(() => completionContext(input), [input])
	const candidates = useMemo(
		() => completionCandidates(ctx, { refs }),
		[ctx, refs],
	)
	// Only worth showing once the user has started a word; a bare list of every
	// subcommand on an empty input is noise.
	const showCandidates = ctx.prefix !== "" && candidates.length > 0

	function setTyped(value: string) {
		setInput(value)
		setHistoryPos(-1)
		setCycle(null)
	}

	function complete() {
		// Already cycling: step to the next alternative, replacing from the word's
		// original start.
		if (cycle !== null) {
			const pos = (cycle.pos + 1) % cycle.candidates.length
			setInput(input.slice(0, cycle.start) + cycle.candidates[pos])
			setCycle({ ...cycle, pos })
			return
		}
		if (candidates.length === 0) {
			return
		}
		if (candidates.length === 1) {
			setInput(applyCompletion(input, ctx, candidates[0], true))
			return
		}
		// Shell behaviour: first go as far as is unambiguous...
		const common = longestCommonPrefix(candidates)
		if (common.length > ctx.prefix.length) {
			setInput(applyCompletion(input, ctx, common, false))
			return
		}
		// ...and once nothing more is shared, start offering them one at a time.
		// Inserted WITHOUT a trailing space, so the word stays the one being
		// completed and the next Tab can replace it.
		setInput(applyCompletion(input, ctx, candidates[0], false))
		setCycle({ start: ctx.start, candidates, pos: 0 })
	}

	function recall(delta: number) {
		if (history.length === 0) {
			return
		}
		const next = Math.min(history.length - 1, Math.max(-1, historyPos + delta))
		setHistoryPos(next)
		setInput(next === -1 ? "" : history[next])
		setCycle(null)
	}

	function onKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Escape") {
			// Claim the key so the output panel behind us doesn't also close: one
			// Escape should dismiss one thing.
			e.preventDefault()
			onClose()
			return
		}
		if (e.key === "Tab") {
			// Never let Tab move focus out of the palette.
			e.preventDefault()
			complete()
			return
		}
		if (e.key === "Enter") {
			e.preventDefault()
			const trimmed = input.trim()
			if (trimmed !== "") {
				onRun(trimmed)
			}
			return
		}
		// Older entries are further down the list, so Up walks back in time.
		if (e.key === "ArrowUp") {
			e.preventDefault()
			recall(1)
		} else if (e.key === "ArrowDown") {
			e.preventDefault()
			recall(-1)
		}
	}

	return (
		// Clicking away is the other conventional dismissal.
		<div className="palette-backdrop" onMouseDown={onClose}>
			{/* stopPropagation keeps a click inside the panel from reaching the
			    backdrop's dismiss handler. */}
			<div
				className="palette"
				onMouseDown={(e) => e.stopPropagation()}
				onKeyDown={onKeyDown}
			>
				<div className="palette-field">
					<Terminal />
					<input
						{...NO_AUTOCORRECT}
						ref={inputRef}
						type="text"
						className="palette-input"
						aria-label="Git command"
						placeholder="git checkout main"
						value={input}
						onChange={(e) => setTyped(e.target.value)}
					/>
				</div>
				{showCandidates && (
					<div className="palette-candidates">
						{candidates.slice(0, MAX_VISIBLE_CANDIDATES).map((c) => (
							<button
								key={c}
								type="button"
								className={`palette-candidate ${
									cycle !== null && cycle.candidates[cycle.pos] === c
										? "is-active"
										: ""
								}`}
								// Keeps focus in the input so typing can continue.
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => {
									setInput(applyCompletion(input, ctx, c, true))
									setCycle(null)
									inputRef.current?.focus()
								}}
							>
								{c}
							</button>
						))}
						{candidates.length > MAX_VISIBLE_CANDIDATES && (
							<span className="palette-more">
								+{candidates.length - MAX_VISIBLE_CANDIDATES} more
							</span>
						)}
					</div>
				)}
				<div className="palette-hint">
					<kbd>Tab</kbd> complete · <kbd>↑</kbd>
					<kbd>↓</kbd> history · <kbd>Enter</kbd> run · <kbd>Esc</kbd> cancel
				</div>
			</div>
		</div>
	)
}
