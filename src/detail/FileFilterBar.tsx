import { Flask, Funnel } from "@phosphor-icons/react"
import "./FileFilterBar.css"
import type { FileFilter } from "./fileFilter"

export function FileFilterBar({
	testCount,
	hideTests,
	onToggleHideTests,
	filters,
	open,
	onToggleOpen,
}: {
	testCount: number
	hideTests: boolean
	onToggleHideTests: () => void
	filters: FileFilter[]
	open: boolean
	onToggleOpen: () => void
}) {
	const hasEnabled = filters.some((f) => f.enabled)

	return (
		<div className="filter-bar">
			{testCount > 0 && (
				<button
					type="button"
					className={`detail-hide-tests ${hideTests ? "is-on" : ""}`}
					title="Hide .test./.spec. files"
					onClick={onToggleHideTests}
				>
					<Flask aria-hidden="true" />
					{hideTests
						? `Show tests (${testCount})`
						: `Hide tests (${testCount})`}
				</button>
			)}
			<button
				type="button"
				className={`filter-icon-btn ${hasEnabled ? "is-active" : ""}`}
				title="File filters — hide/highlight by pattern"
				aria-label="File filters"
				aria-expanded={open}
				onClick={onToggleOpen}
			>
				<Funnel aria-hidden="true" />
				{hasEnabled && (
					<span className="filter-active-dot" aria-hidden="true" />
				)}
			</button>
		</div>
	)
}
