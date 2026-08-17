import {
	Eraser,
	Question,
	Terminal,
	TerminalWindow,
} from "@phosphor-icons/react"
import { useEffect, useRef } from "react"
import type { GitConsoleEntry } from "../ipc/bindings"
import "./GitConsole.css"

function formatTime(ms: number): string {
	const d = new Date(ms)
	const p = (n: number) => String(n).padStart(2, "0")
	return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function GitConsole({
	entries,
	open,
	onToggle,
	onClear,
	onOpenTerminal,
	onOpenHelp,
}: {
	entries: GitConsoleEntry[]
	open: boolean
	onToggle: () => void
	onClear: () => void
	// The bottom bar is the app's only always-visible strip, so these two live
	// here rather than in the console proper.
	onOpenTerminal: () => void
	onOpenHelp: () => void
}) {
	const bodyRef = useRef<HTMLDivElement>(null)

	// Newest entry is at the bottom (terminal convention); keep it in view.
	useEffect(() => {
		if (open && bodyRef.current) {
			bodyRef.current.scrollTop = bodyRef.current.scrollHeight
		}
	}, [open, entries])

	return (
		<div className={`git-console ${open ? "is-open" : ""}`}>
			<div className="git-console-header">
				<button
					type="button"
					className="git-console-title"
					onClick={onToggle}
					title={open ? "Collapse git console" : "Expand git console"}
					aria-label={open ? "Collapse git console" : "Expand git console"}
				>
					<Terminal />
					<span className="git-console-caret">{open ? "▾" : "▸"}</span>
					Git console
					<span className="git-console-count">{entries.length}</span>
					{open && <span className="git-console-hint">newest at bottom</span>}
				</button>
				<div className="git-console-actions">
					<button
						type="button"
						className="git-console-clear"
						onClick={onClear}
						disabled={entries.length === 0}
						title="Clear console"
						aria-label="Clear console"
					>
						<Eraser />
						Clear
					</button>
					<button
						type="button"
						className="git-console-icon"
						onClick={onOpenTerminal}
						title="Open a terminal in the repository folder"
						aria-label="Open a terminal in the repository folder"
					>
						<TerminalWindow />
					</button>
					<button
						type="button"
						className="git-console-icon"
						onClick={onOpenHelp}
						title="Shortcuts and settings"
						aria-label="Shortcuts and settings"
					>
						<Question />
					</button>
				</div>
			</div>
			{open && (
				<div className="git-console-body" ref={bodyRef}>
					{entries.map((e) => (
						<div key={e.id} className="git-console-entry">
							<div className="git-console-meta">
								<span className="git-console-time">
									{formatTime(e.timestamp_ms)}
								</span>
								<span
									className={`git-console-exit ${e.exit_code === 0 ? "ok" : "err"}`}
								>
									exit {e.exit_code} · {e.duration_ms}ms
								</span>
							</div>
							<code className="git-console-cmd" title={e.command}>
								{e.command}
							</code>
							{e.stderr.trim() !== "" && (
								<pre className="git-console-stderr">{e.stderr}</pre>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	)
}
