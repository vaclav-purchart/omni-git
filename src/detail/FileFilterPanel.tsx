import { Plus, Trash } from "@phosphor-icons/react"
import { forwardRef, useState } from "react"
import "./FileFilterPanel.css"
import { NO_AUTOCORRECT } from "../ui/textInput"
import type { FileFilter } from "./fileFilter"

export const FileFilterPanel = forwardRef<
	HTMLDivElement,
	{
		filters: FileFilter[]
		onAddFilter: (pattern: string, mode: FileFilter["mode"]) => void
		onUpdateFilter: (id: string, patch: Partial<Omit<FileFilter, "id">>) => void
		onRemoveFilter: (id: string) => void
		onSetEnabled: (id: string, enabled: boolean) => void
	}
>(function FileFilterPanel(
	{ filters, onAddFilter, onUpdateFilter, onRemoveFilter, onSetEnabled },
	ref,
) {
	const [draftPattern, setDraftPattern] = useState("")
	const [draftMode, setDraftMode] = useState<FileFilter["mode"]>("hide")

	function addFromDraft() {
		const pattern = draftPattern.trim()
		if (pattern === "") {
			return
		}
		onAddFilter(pattern, draftMode)
		setDraftPattern("")
	}

	return (
		<div
			ref={ref}
			className="filter-panel"
			role="group"
			aria-label="File filters"
		>
			<div className="filter-add-row">
				<input
					{...NO_AUTOCORRECT}
					type="text"
					className="filter-add-input"
					placeholder="e.g. *.test.*  or  dist/**"
					value={draftPattern}
					onChange={(e) => setDraftPattern(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							addFromDraft()
						}
					}}
				/>
				<select
					className="filter-add-mode"
					value={draftMode}
					onChange={(e) => setDraftMode(e.target.value as FileFilter["mode"])}
				>
					<option value="hide">hide</option>
					<option value="highlight">highlight</option>
				</select>
				<button
					type="button"
					className="filter-add-btn"
					onClick={addFromDraft}
					disabled={draftPattern.trim() === ""}
				>
					<Plus />
					Add
				</button>
			</div>
			{filters.length === 0 ? (
				<div className="filter-empty-hint">
					No filters yet — add a glob pattern above.
				</div>
			) : (
				<ul className="filter-list">
					{filters.map((f) => (
						<li key={f.id} className="filter-row">
							<input
								{...NO_AUTOCORRECT}
								type="checkbox"
								checked={f.enabled}
								aria-label={`Enable filter ${f.pattern}`}
								onChange={(e) => onSetEnabled(f.id, e.target.checked)}
							/>
							<span className="filter-pattern">{f.pattern}</span>
							<select
								value={f.mode}
								onChange={(e) =>
									onUpdateFilter(f.id, {
										mode: e.target.value as FileFilter["mode"],
									})
								}
							>
								<option value="hide">hide</option>
								<option value="highlight">highlight</option>
							</select>
							<button
								type="button"
								className="filter-remove-btn"
								aria-label="Remove filter"
								onClick={() => onRemoveFilter(f.id)}
							>
								<Trash />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
})
