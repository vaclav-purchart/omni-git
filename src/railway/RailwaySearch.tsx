import { CaretDown, CaretUp, MagnifyingGlass, X } from "@phosphor-icons/react"
import { NO_AUTOCORRECT } from "../ui/textInput"
import type { CommitFilter } from "./commitMatch"

export function RailwaySearch({
	filter,
	onFilterChange,
	active,
	matchCount,
	currentMatch,
	onPrev,
	onNext,
	onClear,
}: {
	filter: CommitFilter
	onFilterChange: (f: CommitFilter) => void
	active: boolean
	matchCount: number
	currentMatch: number // 1-based index of the focused match, 0 when none
	onPrev: () => void
	onNext: () => void
	onClear: () => void
}) {
	return (
		<div className="railway-search">
			<div className="railway-search-field">
				<MagnifyingGlass className="railway-search-icon" aria-hidden="true" />
				<input
					{...NO_AUTOCORRECT}
					className="railway-search-input"
					placeholder="Search message or hash…"
					value={filter.query}
					onChange={(e) => onFilterChange({ ...filter, query: e.target.value })}
				/>
			</div>
			<input
				{...NO_AUTOCORRECT}
				className="railway-search-author"
				placeholder="Author"
				value={filter.author}
				onChange={(e) => onFilterChange({ ...filter, author: e.target.value })}
			/>
			{active && (
				<div className="railway-search-nav">
					<span className="railway-search-count">
						{matchCount === 0
							? "no matches"
							: `${currentMatch} of ${matchCount}`}
					</span>
					<button
						type="button"
						className="btn btn-icon"
						aria-label="Previous match"
						title="Previous match"
						disabled={matchCount === 0}
						onClick={onPrev}
					>
						<CaretUp aria-hidden="true" />
					</button>
					<button
						type="button"
						className="btn btn-icon"
						aria-label="Next match"
						title="Next match"
						disabled={matchCount === 0}
						onClick={onNext}
					>
						<CaretDown aria-hidden="true" />
					</button>
					<button
						type="button"
						className="btn btn-icon"
						aria-label="Clear search"
						title="Clear search"
						onClick={onClear}
					>
						<X aria-hidden="true" />
					</button>
				</div>
			)}
		</div>
	)
}
