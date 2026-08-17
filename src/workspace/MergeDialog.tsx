import { useEffect, useRef, useState } from "react"
import type { MergeMode } from "../ipc/bindings"
import { BranchPicker } from "../ui/BranchPicker"
import { usePersistentState } from "../ui/usePersistentState"
import "../ui/ConfirmDialog.css"
import "./ResetDialog.css"
import "./MergeDialog.css"

const MODES: Array<{ mode: MergeMode; label: string; detail: string }> = [
	{
		mode: "Commit",
		label: "Always create a merge commit",
		detail:
			"Records the merge even when the branch could simply fast-forward, so the shape of the work survives in the history. Git's --no-ff.",
	},
	{
		mode: "FastForward",
		label: "Fast-forward when possible",
		detail:
			"Moves the branch pointer forward with no merge commit if nothing has diverged; otherwise merges normally. Git's default.",
	},
	{
		mode: "Squash",
		label: "Squash, without committing",
		detail:
			"Applies the result as staged changes with no merge recorded, to commit by hand as one. Git's --squash.",
	},
]

/**
 * Chooses what to merge and how, in one step — the same shape as ResetDialog and
 * FetchDialog, remembering the mode for next time.
 *
 * The branch is NOT remembered: the mode is a habit, but which branch you are
 * merging is the whole question and pre-filling it would be a way to merge the
 * wrong one.
 */
export function MergeDialog({
	open,
	current,
	branches,
	onCancel,
	onConfirm,
}: {
	open: boolean
	/** The branch being merged INTO, for the message. Null when detached. */
	current: string | null
	/** Everything that can be merged: local branches and remote-tracking refs. */
	branches: string[]
	onCancel: () => void
	onConfirm: (target: string, mode: MergeMode) => void
}) {
	const [remembered, setRemembered] = usePersistentState<MergeMode>(
		"merge-mode",
		"FastForward",
	)
	const [mode, setMode] = useState<MergeMode>(remembered)
	const [target, setTarget] = useState("")
	const modeRef = useRef<HTMLInputElement>(null)

	// Re-seeded each time it opens, so an abandoned dialog doesn't leave a
	// half-made choice — or a half-typed branch — behind.
	useEffect(() => {
		if (open) {
			setMode(remembered)
			setTarget("")
		}
	}, [open, remembered])

	useEffect(() => {
		if (open) {
			modeRef.current?.focus()
		}
	}, [open])

	// Choosing a branch unmounts the picker's popup, which drops focus onto the
	// document body — and from there Enter reaches nothing, so the dialog silently
	// stopped being completable by keyboard at exactly the point it was ready.
	// Pull focus back to the modes, which is where the flow continues.
	useEffect(() => {
		if (open && target !== "") {
			modeRef.current?.focus()
		}
	}, [open, target])

	if (!open) {
		return null
	}

	const chosen = branches.includes(target.trim())
	function confirm() {
		if (!chosen) {
			return
		}
		setRemembered(mode)
		onConfirm(target.trim(), mode)
	}

	return (
		<div className="confirm-overlay" role="presentation">
			<div
				className="confirm-dialog reset-dialog merge-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Merge"
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
				<p className="confirm-message">
					Merge into <strong>{current ?? "the detached HEAD"}</strong>
				</p>
				<div className="merge-target">
					<span className="reset-legend">Branch to merge in</span>
					<BranchPicker
						value={target}
						options={branches}
						onChange={setTarget}
						placeholder="branch…"
					/>
				</div>
				<fieldset className="reset-modes">
					<legend className="reset-legend">How it lands</legend>
					{MODES.map((m) => (
						<label key={m.mode} className="reset-mode">
							<input
								ref={mode === m.mode ? modeRef : undefined}
								type="radio"
								name="merge-mode"
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
						disabled={!chosen}
						title={chosen ? undefined : "Pick a branch to merge"}
						onClick={confirm}
					>
						Merge
					</button>
				</div>
			</div>
		</div>
	)
}
