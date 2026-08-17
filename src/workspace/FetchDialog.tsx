import { useEffect, useRef, useState } from "react"
import { usePersistentState } from "../ui/usePersistentState"
import "../ui/ConfirmDialog.css"
import "./ResetDialog.css"

/** Whether the fetch drops remote-tracking refs for branches gone upstream. */
export type FetchMode = "prune" | "keep"

const MODES: Array<{ mode: FetchMode; label: string; detail: string }> = [
	{
		mode: "prune",
		label: "Prune deleted remote branches",
		detail:
			"Drops remote-tracking refs like origin/old-feature once the branch is gone from the remote. Your local branches are never touched.",
	},
	{
		mode: "keep",
		label: "Keep every remote branch",
		detail:
			"Leaves stale remote-tracking refs in place, even for branches that no longer exist upstream.",
	},
]

/**
 * Chooses how to fetch, and confirms, in one step — the same shape as
 * ResetDialog, and remembering the last choice for the same reason: fetching
 * comes in runs, and whichever way you want it today is probably the way you
 * want it next time.
 */
export function FetchDialog({
	open,
	onCancel,
	onConfirm,
}: {
	open: boolean
	onCancel: () => void
	onConfirm: (mode: FetchMode) => void
}) {
	const [remembered, setRemembered] = usePersistentState<FetchMode>(
		"fetch-mode",
		"prune",
	)
	const [mode, setMode] = useState<FetchMode>(remembered)
	const modeRef = useRef<HTMLInputElement>(null)

	// Re-seeded each time it opens, so an abandoned dialog doesn't leave a
	// half-made choice behind.
	useEffect(() => {
		if (open) {
			setMode(remembered)
		}
	}, [open, remembered])

	// Focus the chosen mode: the arrows move between modes straight away, and
	// Enter confirms from there.
	useEffect(() => {
		if (open) {
			modeRef.current?.focus()
		}
	}, [open])

	if (!open) {
		return null
	}

	function confirm() {
		setRemembered(mode)
		onConfirm(mode)
	}

	return (
		<div className="confirm-overlay" role="presentation">
			<div
				className="confirm-dialog reset-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Fetch"
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						// Claim it so nothing behind us also closes.
						e.preventDefault()
						onCancel()
						return
					}
					// Skipped when a BUTTON has focus — its own activation is about to
					// fire, and handling it here too would run both actions.
					if (
						e.key === "Enter" &&
						(e.target as HTMLElement).tagName !== "BUTTON"
					) {
						e.preventDefault()
						confirm()
					}
				}}
			>
				<p className="confirm-message">Fetch all remotes</p>
				<fieldset className="reset-modes">
					<legend className="reset-legend">
						What happens to branches deleted upstream
					</legend>
					{MODES.map((m) => (
						<label key={m.mode} className="reset-mode">
							<input
								ref={mode === m.mode ? modeRef : undefined}
								type="radio"
								name="fetch-mode"
								value={m.mode}
								checked={mode === m.mode}
								onChange={() => setMode(m.mode)}
							/>
							<span className="reset-mode-label">{m.label}</span>
							<span className="reset-mode-detail">{m.detail}</span>
						</label>
					))}
				</fieldset>
				<div className="confirm-actions">
					<button type="button" className="confirm-cancel" onClick={onCancel}>
						Cancel
					</button>
					<button type="button" className="confirm-primary" onClick={confirm}>
						Fetch
					</button>
				</div>
			</div>
		</div>
	)
}
