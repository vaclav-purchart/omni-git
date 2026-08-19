import { CaretDown, CaretUp, MagnifyingGlass, X } from "@phosphor-icons/react"
import { useEffect, useRef } from "react"
import { NO_AUTOCORRECT } from "../ui/textInput"
import { MATCH_LIMIT } from "./searchMatches"
import "./DiffSearch.css"

/**
 * The diff's find bar: query, position, prev/next, close.
 *
 * Shaped after RailwaySearch so the two searches in the app read the same way —
 * same wording ("3 of 17", "no matches"), same caret buttons, same X to dismiss.
 * Presentational: the matches themselves are found and highlighted by DiffView,
 * which owns the editor.
 */
export function DiffSearch({
	query,
	onQueryChange,
	matchCount,
	currentMatch,
	onPrev,
	onNext,
	onClose,
}: {
	query: string
	onQueryChange: (q: string) => void
	matchCount: number
	/** 1-based position of the focused match; 0 when none is. */
	currentMatch: number
	onPrev: () => void
	onNext: () => void
	onClose: () => void
}) {
	const inputRef = useRef<HTMLInputElement>(null)

	// The bar only exists while searching, so mount IS open.
	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	return (
		// The diff panel handles Backspace and the arrows itself; those must not fire
		// while a query is being typed into this.
		<div
			className="diff-search"
			onKeyDown={(e) => {
				e.stopPropagation()
				if (e.key === "Escape") {
					e.preventDefault()
					onClose()
					return
				}
				if (e.key === "Enter") {
					e.preventDefault()
					if (e.shiftKey) {
						onPrev()
					} else {
						onNext()
					}
				}
			}}
		>
			<div className="diff-search-field">
				<MagnifyingGlass className="diff-search-icon" aria-hidden="true" />
				<input
					{...NO_AUTOCORRECT}
					ref={inputRef}
					type="text"
					className="diff-search-input"
					aria-label="Search the diff"
					placeholder="Find in diff…"
					value={query}
					onChange={(e) => onQueryChange(e.target.value)}
				/>
			</div>
			{query.trim() !== "" && (
				<span className="diff-search-count">
					{matchCount === 0
						? "no matches"
						: // Past the cap the total is a floor, not a count.
							`${currentMatch} of ${matchCount}${
								matchCount >= MATCH_LIMIT ? "+" : ""
							}`}
				</span>
			)}
			<button
				type="button"
				className="btn btn-icon"
				aria-label="Previous match"
				title="Previous match (⇧Enter)"
				disabled={matchCount === 0}
				onClick={onPrev}
			>
				<CaretUp aria-hidden="true" />
			</button>
			<button
				type="button"
				className="btn btn-icon"
				aria-label="Next match"
				title="Next match (Enter)"
				disabled={matchCount === 0}
				onClick={onNext}
			>
				<CaretDown aria-hidden="true" />
			</button>
			<button
				type="button"
				className="btn btn-icon"
				aria-label="Close search"
				title="Close search (Esc)"
				onClick={onClose}
			>
				<X aria-hidden="true" />
			</button>
		</div>
	)
}
