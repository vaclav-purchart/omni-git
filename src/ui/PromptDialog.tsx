import { useEffect, useRef, useState } from "react"
import "./ConfirmDialog.css"
import { NO_AUTOCORRECT } from "./textInput"

/**
 * A one-field dialog, for things like a new branch name.
 *
 * Shares ConfirmDialog's styling so the two read as the same kind of thing. Enter
 * confirms and Escape cancels, and confirming is blocked while the field is
 * empty — a branch called "" would just be a git error.
 */
export function PromptDialog({
	open,
	message,
	confirmLabel,
	placeholder,
	initialValue = "",
	onConfirm,
	onCancel,
}: {
	open: boolean
	message: string
	confirmLabel: string
	placeholder?: string
	initialValue?: string
	onConfirm: (value: string) => void
	onCancel: () => void
}) {
	const [value, setValue] = useState(initialValue)
	const inputRef = useRef<HTMLInputElement>(null)

	// Reset per opening, so a previous attempt's text doesn't reappear.
	useEffect(() => {
		if (open) {
			setValue(initialValue)
		}
	}, [open, initialValue])

	useEffect(() => {
		if (open) {
			inputRef.current?.focus()
			inputRef.current?.select()
		}
	}, [open])

	if (!open) {
		return null
	}

	const trimmed = value.trim()

	function submit() {
		if (trimmed !== "") {
			onConfirm(trimmed)
		}
	}

	return (
		<div className="confirm-overlay" role="presentation">
			{/* A real dialog role: it had none, so assistive tech announced it as a
			    bare group and its controls were indistinguishable from the ones on
			    the page behind it. */}
			<div
				className="confirm-dialog"
				role="dialog"
				aria-modal="true"
				aria-label={message}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						// Claim it so nothing behind us also closes.
						e.preventDefault()
						onCancel()
					} else if (e.key === "Enter") {
						e.preventDefault()
						submit()
					}
				}}
			>
				<p className="confirm-message">{message}</p>
				<input
					{...NO_AUTOCORRECT}
					ref={inputRef}
					type="text"
					className="confirm-input"
					aria-label={message}
					placeholder={placeholder}
					value={value}
					onChange={(e) => setValue(e.target.value)}
				/>
				<div className="confirm-actions">
					<button type="button" className="confirm-cancel" onClick={onCancel}>
						Cancel
					</button>
					<button
						type="button"
						className="confirm-primary"
						disabled={trimmed === ""}
						onClick={submit}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	)
}
