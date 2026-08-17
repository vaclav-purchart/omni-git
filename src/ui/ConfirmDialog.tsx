import { Trash } from "@phosphor-icons/react"
import { useEffect, useRef } from "react"
import "./ConfirmDialog.css"

export function ConfirmDialog({
	open,
	message,
	confirmLabel,
	onConfirm,
	onCancel,
}: {
	open: boolean
	message: string
	confirmLabel: string
	onConfirm: () => void
	onCancel: () => void
}) {
	const confirmRef = useRef<HTMLButtonElement>(null)

	// Escape cancels — this dialog gates a destructive operation, so it must
	// never be a keyboard trap.
	useEffect(() => {
		if (!open) {
			return
		}
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				// Claim the key so outer Escape handlers (e.g. the command-output
				// panel) stand down. Listening on `document` rather than `window`
				// makes that deterministic: document sees the event first while it
				// bubbles, regardless of which component mounted first.
				e.preventDefault()
				onCancel()
			}
		}
		document.addEventListener("keydown", onKeyDown)
		return () => document.removeEventListener("keydown", onKeyDown)
	}, [open, onCancel])

	// Autofocus the CONFIRM button, so Enter completes the dialog and Escape
	// cancels it — a confirmation you can only finish with the mouse is a dead end
	// in the middle of a keyboard flow.
	//
	// This used to focus Cancel, on the theory that a stray Enter should not do the
	// destructive thing. The cost was worse: the focus ring sat on Cancel while
	// nothing on the keyboard reached Confirm without a Tab first. Focus now says
	// exactly what Enter will do, which is the property that actually keeps this
	// safe.
	useEffect(() => {
		if (open) {
			confirmRef.current?.focus()
		}
	}, [open])

	if (!open) {
		return null
	}
	return (
		<div className="confirm-overlay" onClick={onCancel} role="presentation">
			<div
				className="confirm-dialog"
				role="alertdialog"
				aria-modal="true"
				onClick={(e) => e.stopPropagation()}
			>
				<p className="confirm-message">{message}</p>
				<div className="confirm-actions">
					<button type="button" className="confirm-cancel" onClick={onCancel}>
						Cancel
					</button>
					<button
						type="button"
						ref={confirmRef}
						className="confirm-danger"
						onClick={onConfirm}
					>
						<Trash />
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	)
}
