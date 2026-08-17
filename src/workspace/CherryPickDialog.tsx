import { useEffect, useRef, useState } from "react"
import { usePersistentState } from "../ui/usePersistentState"
import "../ui/ConfirmDialog.css"
import "./ResetDialog.css"
import "./CherryPickDialog.css"

/** Whether each pick becomes a commit, or lands as staged changes. */
export type CherryPickMode = "commit" | "stage"

const MODES: Array<{
	mode: CherryPickMode
	label: string
	detail: string
}> = [
	{
		mode: "commit",
		label: "Commit each one",
		detail: "One new commit per picked commit, keeping their messages.",
	},
	{
		mode: "stage",
		label: "Apply without committing",
		detail:
			"Leaves the combined changes staged, to review or commit as one. Git's --no-commit.",
	},
]

/**
 * Chooses how to cherry-pick, and confirms, in one step — the same shape as
 * ResetDialog, for the same reason: the mode is what the action IS, so it should
 * be visible at the moment of confirming rather than remembered from a menu click.
 *
 * The last mode used is persisted; picking is something people do in runs, and
 * whichever way you want them today is probably the way you want the next one.
 */
export function CherryPickDialog({
	open,
	commits,
	branch,
	onCancel,
	onConfirm,
}: {
	open: boolean
	/** Full hashes, newest first, as the log shows them. */
	commits: string[]
	/** Where they'll land. Null when HEAD is detached. */
	branch: string | null
	onCancel: () => void
	onConfirm: (mode: CherryPickMode) => void
}) {
	const [remembered, setRemembered] = usePersistentState<CherryPickMode>(
		"cherry-pick-mode",
		"commit",
	)
	const [mode, setMode] = useState<CherryPickMode>(remembered)
	const modeRef = useRef<HTMLInputElement>(null)

	// Re-seeded each time it opens, so an abandoned dialog doesn't leave a
	// half-made choice behind.
	useEffect(() => {
		if (open) {
			setMode(remembered)
		}
	}, [open, remembered])

	// Focus the chosen mode, so the arrows move between modes straight away and
	// Enter confirms from there — same reasoning as ResetDialog.
	useEffect(() => {
		if (open) {
			modeRef.current?.focus()
		}
	}, [open])

	if (!open) {
		return null
	}

	const n = commits.length
	const target = branch === null ? "the detached HEAD" : branch

	return (
		<div className="confirm-overlay" role="presentation">
			<div
				className="confirm-dialog reset-dialog cherry-dialog"
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
					{n === 1 ? "Cherry-pick " : `Cherry-pick ${n} commits `}
					{n === 1 && <code>{commits[0].slice(0, 7)}</code>}
					{" onto "}
					<strong>{target}</strong>
				</p>
				{n > 1 && (
					// Oldest first, which is the order they will be applied — not the
					// order the log showed them in.
					<ol className="cherry-list">
						{[...commits].reverse().map((h) => (
							<li key={h}>
								<code>{h.slice(0, 7)}</code>
							</li>
						))}
					</ol>
				)}
				<fieldset className="reset-modes">
					<legend className="reset-legend">What lands on the branch</legend>
					{MODES.map((m) => (
						<label key={m.mode} className="reset-mode">
							<input
								ref={mode === m.mode ? modeRef : undefined}
								type="radio"
								name="cherry-pick-mode"
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
						className="confirm-primary"
						onClick={() => {
							setRemembered(mode)
							onConfirm(mode)
						}}
					>
						{n === 1 ? "Cherry-pick" : `Cherry-pick ${n}`}
					</button>
				</div>
			</div>
		</div>
	)
}
