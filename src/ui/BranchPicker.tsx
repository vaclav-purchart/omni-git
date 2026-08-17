import { CaretDown, GitBranch } from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState } from "react"
import "./BranchPicker.css"
import { NO_AUTOCORRECT } from "./textInput"

export function BranchPicker({
	value,
	options,
	onChange,
	placeholder,
}: {
	value: string
	options: string[]
	onChange: (v: string) => void
	placeholder?: string
}) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const rootRef = useRef<HTMLDivElement>(null)

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		return q === ""
			? options
			: options.filter((o) => o.toLowerCase().includes(q))
	}, [query, options])

	useEffect(() => {
		if (!open) {
			return
		}
		function onDocDown(e: MouseEvent) {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false)
			}
		}
		document.addEventListener("mousedown", onDocDown)
		return () => document.removeEventListener("mousedown", onDocDown)
	}, [open])

	function choose(v: string) {
		onChange(v)
		setOpen(false)
		setQuery("")
	}

	return (
		<div className="branch-picker" ref={rootRef}>
			<button
				type="button"
				className="branch-picker-value"
				onClick={() => setOpen((o) => !o)}
				title={value || placeholder}
			>
				<GitBranch aria-hidden="true" />
				<span className="branch-picker-label">
					{value || placeholder || "select…"}
				</span>
				<CaretDown aria-hidden="true" />
			</button>
			{open && (
				<div className="branch-picker-pop">
					<input
						{...NO_AUTOCORRECT}
						className="branch-picker-search"
						placeholder="Filter branches…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								setOpen(false)
							} else if (e.key === "Enter" && filtered.length > 0) {
								choose(filtered[0])
							}
						}}
						autoFocus
					/>
					<ul className="branch-picker-list">
						{filtered.map((o) => (
							<li key={o}>
								<button
									type="button"
									className={`branch-picker-option ${o === value ? "is-selected" : ""}`}
									onClick={() => choose(o)}
									title={o}
								>
									{o}
								</button>
							</li>
						))}
						{filtered.length === 0 && (
							<li className="branch-picker-empty">No matches</li>
						)}
					</ul>
				</div>
			)}
		</div>
	)
}
