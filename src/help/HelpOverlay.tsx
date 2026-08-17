import { MagnifyingGlass, X } from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { getSetting, setSetting } from "../settings/settings"
import { isMacPlatform } from "../workspace/shortcuts"
import { groupShortcuts } from "./shortcutList"
import "./HelpOverlay.css"
import { NO_AUTOCORRECT } from "../ui/textInput"

const TERMINAL_KEY = "terminal-command"

function readTerminalCommand(): string {
	try {
		const raw = getSetting(TERMINAL_KEY)
		const value = raw === null ? "" : JSON.parse(raw)
		return typeof value === "string" ? value : ""
	} catch {
		return ""
	}
}

/**
 * Help: a searchable list of every shortcut, plus the preferences that don't
 * belong anywhere else yet.
 *
 * An overlay rather than an inline panel — unlike the filter and commit panels,
 * this is reference material you open, read and dismiss, and it takes over the
 * keyboard while open (same as the command palette).
 */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
	const [query, setQuery] = useState("")
	const [terminal, setTerminal] = useState(readTerminalCommand)
	const inputRef = useRef<HTMLInputElement>(null)
	const isMac = isMacPlatform()

	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	const groups = useMemo(() => groupShortcuts(query, isMac), [query, isMac])
	const total = useMemo(
		() => groups.reduce((n, g) => n + g.items.length, 0),
		[groups],
	)

	function updateTerminal(value: string) {
		setTerminal(value)
		setSetting(TERMINAL_KEY, JSON.stringify(value))
	}

	return (
		<div className="help-backdrop" onMouseDown={onClose}>
			{/* stopPropagation keeps a click inside the panel from dismissing it. */}
			<div
				className="help"
				onMouseDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						// Claim the key so nothing behind us also closes.
						e.preventDefault()
						onClose()
					}
				}}
			>
				<div className="help-header">
					<MagnifyingGlass />
					<input
						{...NO_AUTOCORRECT}
						ref={inputRef}
						type="text"
						className="help-search"
						aria-label="Search shortcuts and settings"
						placeholder="Search shortcuts…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
					<button
						type="button"
						className="help-close"
						aria-label="Close help"
						onClick={onClose}
					>
						<X />
					</button>
				</div>

				<div className="help-body">
					<section className="help-section">
						<h2 className="help-section-title">Terminal</h2>
						<label className="help-field" htmlFor="help-terminal-command">
							<span className="help-field-label">Terminal command</span>
							<input
								{...NO_AUTOCORRECT}
								id="help-terminal-command"
								type="text"
								className="help-input"
								placeholder={
									isMac ? "open -a Terminal" : "leave empty to auto-detect"
								}
								value={terminal}
								onChange={(e) => updateTerminal(e.target.value)}
							/>
						</label>
						<p className="help-hint">
							Used by the terminal button. Leave empty to auto-detect.{" "}
							<code>{"{dir}"}</code> is replaced with the repository path; if
							you omit it, the path is appended. Quote arguments containing
							spaces, e.g. <code>open -a "iTerm 2" {"{dir}"}</code>.
						</p>
					</section>

					<section className="help-section">
						<h2 className="help-section-title">
							Keyboard shortcuts
							{query.trim() !== "" && (
								<span className="help-count">{total} matching</span>
							)}
						</h2>
						{total === 0 ? (
							<p className="help-hint">No shortcuts match “{query.trim()}”.</p>
						) : (
							groups.map((group) => (
								<div key={group.context} className="help-group">
									<h3 className="help-group-title">{group.context}</h3>
									<ul className="help-list">
										{group.items.map((s) => (
											<li
												key={`${group.context}:${s.keys}:${s.description}`}
												className="help-row"
											>
												<kbd className="help-keys">{s.keys}</kbd>
												<span className="help-desc">{s.description}</span>
											</li>
										))}
									</ul>
								</div>
							))
						)}
					</section>
				</div>
			</div>
		</div>
	)
}
