import { useEffect, useRef, useState } from "react"
import type { ResetMode } from "../ipc/bindings"
import { usePersistentState } from "../ui/usePersistentState"
import "../ui/ConfirmDialog.css"
import "./ResetDialog.css"
import { NO_AUTOCORRECT } from "../ui/textInput"

/** What each mode does, in the terms that matter when choosing one. */
const MODES: Array<{
	mode: ResetMode
	label: string
	detail: string
	destructive?: boolean
}> = [
	{
		mode: "Soft",
		label: "Soft",
		detail: "Keep the changes staged, ready to re-commit.",
	},
	{
		mode: "Mixed",
		label: "Mixed",
		detail: "Keep the changes as unstaged edits. Git's default.",
	},
	{
		mode: "Hard",
		label: "Hard",
		detail: "Discard the changes entirely. Uncommitted work is lost.",
		destructive: true,
	},
]

/**
 * Chooses a reset mode AND confirms, in one step.
 *
 * Not two menu items plus a confirm: a hard reset can destroy uncommitted work, so
 * it needs confirming anyway, and folding the choice into that dialog means the
 * mode is visible at the moment of confirming rather than remembered from a menu
 * click.
 *
 * The last mode used is persisted, since resets come in runs — several mixed ones
 * while tidying WIP commits.
 */
export function ResetDialog({
	open,
	commit,
	branch,
	onCancel,
	onConfirm,
}: {
	open: boolean
	/** Short hash, for the message. */
	commit: string
	/** Branch being moved, when known. */
	branch: string | null
	onCancel: () => void
	onConfirm: (mode: ResetMode) => void
}) {
	const [remembered, setRemembered] = usePersistentState<ResetMode>(
		"reset-mode",
		"Mixed",
	)
	const [mode, setMode] = useState<ResetMode>(remembered)
	const modeRef = useRef<HTMLInputElement>(null)

	// Re-seed from the remembered value each time it opens, so an abandoned dialog
	// doesn't leave a half-made choice behind.
	useEffect(() => {
		if (open) {
			setMode(remembered)
		}
	}, [open, remembered])

	// Focus the chosen mode, not a button: the arrows then move between modes
	// straight away, and Enter confirms from there. ConfirmDialog focuses its
	// confirm button for the same reason — whatever has focus should be the thing
	// the keyboard is about to act on.
	useEffect(() => {
		if (open) {
			modeRef.current?.focus()
		}
	}, [open])

	if (!open) {
		return null
	}

	const chosen = MODES.find((m) => m.mode === mode)
	const destructive = chosen?.destructive === true

	function confirm() {
		setRemembered(mode)
		onConfirm(mode)
	}

	return (
		<div className="confirm-overlay" role="presentation">
			<div
				className="confirm-dialog reset-dialog"
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						// Claim it so nothing behind us also closes.
						e.preventDefault()
						onCancel()
						return
					}
					// Enter completes the dialog: arrows pick the mode, Enter runs it.
					// Skipped when a BUTTON has focus — that button's own activation is
					// about to fire, and handling it here too would run both actions.
					if (
						e.key === "Enter" &&
						(e.target as HTMLElement).tagName !== "BUTTON"
					) {
						e.preventDefault()
						confirm()
					}
				}}
			>
				<p className="confirm-message">
					Reset {branch === null ? "HEAD" : branch} to{" "}
					<code>{commit.slice(0, 7)}</code>
				</p>
				<fieldset className="reset-modes">
					<legend className="reset-legend">What happens to your changes</legend>
					{MODES.map((m) => (
						<label
							key={m.mode}
							className={`reset-mode ${m.destructive ? "is-destructive" : ""}`}
						>
							<input
								{...NO_AUTOCORRECT}
								ref={mode === m.mode ? modeRef : undefined}
								type="radio"
								name="reset-mode"
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
					<button
						type="button"
						className={destructive ? "confirm-danger" : "confirm-primary"}
						onClick={confirm}
					>
						{destructive ? "Reset and discard" : `Reset (${chosen?.label})`}
					</button>
				</div>
			</div>
		</div>
	)
}
