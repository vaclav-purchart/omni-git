import { useEffect, useRef, useState } from "react"
import { NO_AUTOCORRECT } from "../ui/textInput"
import "../ui/ConfirmDialog.css"
import "./RewordDialog.css"

/**
 * Edits a commit's message.
 *
 * For `HEAD` this is an amend and costs nothing. For anything older it rewrites
 * every commit after it — they record their parent's hash, so a new parent means
 * new hashes all the way down — which the dialog says plainly, because the
 * consequence only bites later, when a push is rejected.
 *
 * The message loads asynchronously (`log` has to be asked for the body), so the
 * dialog opens disabled rather than with an empty box that would look like a
 * commit with no message and could be confirmed as one.
 */
export function RewordDialog({
	open,
	commit,
	original,
	isHead,
	loading,
	onCancel,
	onConfirm,
}: {
	open: boolean
	/** Full hash; shown abbreviated. */
	commit: string
	/** The current message, or null while it's still being read. */
	original: string | null
	/** Whether this is the checked-out commit, i.e. a plain amend. */
	isHead: boolean
	loading: boolean
	onCancel: () => void
	onConfirm: (message: string) => void
}) {
	const [message, setMessage] = useState("")
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	// Seeded from the loaded message rather than held across opens: the dialog is
	// per-commit, and a leftover draft would silently be applied to a different
	// one.
	useEffect(() => {
		if (open && original !== null) {
			setMessage(original)
		}
	}, [open, original])

	useEffect(() => {
		if (open && !loading) {
			textareaRef.current?.focus()
		}
	}, [open, loading])

	if (!open) {
		return null
	}

	const trimmed = message.trim()
	// An empty message would be rejected by git anyway, and unchanged means there
	// is nothing to rewrite — doing the rebase regardless would churn every hash
	// after it for no reason.
	const unchanged = original !== null && trimmed === original.trim()
	const canConfirm = !loading && trimmed !== "" && !unchanged

	return (
		<div className="confirm-overlay" role="presentation">
			<div
				className="confirm-dialog reword-dialog"
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						// Claim it so nothing behind us also closes.
						e.preventDefault()
						onCancel()
						return
					}
					// Cmd/Ctrl+Enter confirms, matching the commit box. A bare Enter has to
					// stay available: this is a multi-line message.
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canConfirm) {
						e.preventDefault()
						onConfirm(trimmed)
					}
				}}
			>
				<p className="confirm-message">
					Reword <code>{commit.slice(0, 7)}</code>
				</p>
				{!isHead && (
					<p className="reword-warning">
						This commit isn't the latest one. Rewording it rebuilds every commit
						after it, so they all get new hashes. Don't do it to history you've
						already pushed.
					</p>
				)}
				<label className="reword-field">
					<span className="reword-label">Message</span>
					<textarea
						{...NO_AUTOCORRECT}
						ref={textareaRef}
						className="reword-input"
						rows={8}
						disabled={loading}
						value={loading ? "" : message}
						placeholder={loading ? "Loading the current message…" : ""}
						onChange={(e) => setMessage(e.target.value)}
					/>
				</label>
				<div className="confirm-actions">
					<button type="button" className="confirm-cancel" onClick={onCancel}>
						Cancel
					</button>
					<button
						type="button"
						className="confirm-primary"
						disabled={!canConfirm}
						title={unchanged ? "The message is unchanged" : undefined}
						onClick={() => onConfirm(trimmed)}
					>
						{isHead ? "Reword" : "Reword and rebuild"}
					</button>
				</div>
			</div>
		</div>
	)
}
