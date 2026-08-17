import { CaretDown, CaretRight } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { commands } from "../ipc/bindings"
import { usePersistentState } from "../ui/usePersistentState"
import "./CommitBox.css"

/**
 * Read-only counterpart to CommitBox, shown at the bottom of the file panel
 * while browsing history. `log_commits` only carries `%s`, so without this the
 * body of a commit message is not visible anywhere in the app.
 *
 * Deliberately read-only: amending from the history view would mix reading and
 * rewriting, and amend already lives in the working-copy view.
 */
export function CommitMessage({
	repoPath,
	hash,
	subject,
}: {
	repoPath: string
	hash: string
	// Shown immediately while the full message loads, so the panel doesn't
	// flash empty on every selection change.
	subject: string
}) {
	// Its own key, NOT shared with the commit box: collapsing the editor to
	// reclaim space while staging shouldn't silently hide messages while
	// reading history.
	const [open, setOpen] = usePersistentState("commit-message-open", true)
	const [message, setMessage] = useState<string | null>(null)
	// Bumped per selection so a slower response for a previously-selected
	// commit can't overwrite the current one's message.
	const reqRef = useRef(0)
	const aliveRef = useRef(true)
	useEffect(() => {
		return () => {
			aliveRef.current = false
		}
	}, [])

	useEffect(() => {
		reqRef.current += 1
		const req = reqRef.current
		setMessage(null)
		commands.commitMessage(repoPath, hash).then((r) => {
			if (!aliveRef.current || reqRef.current !== req) {
				return
			}
			// On failure fall back to the subject we already have rather than
			// showing an error banner — this panel is incidental information,
			// not an action the user asked for.
			setMessage(r.status === "ok" ? r.data : subject)
		})
	}, [repoPath, hash, subject])

	const body = message ?? subject

	return (
		<div className="commitbox">
			<button
				type="button"
				className="commitbox-header"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				{open ? <CaretDown /> : <CaretRight />}
				<span className="commitbox-title">Message</span>
				{!open && (
					<span className="commitbox-preview" title={body}>
						{body.split("\n")[0] ?? ""}
					</span>
				)}
			</button>
			{open && (
				// `pre-wrap` + selectable text: commit messages are wrapped by their
				// author, so re-wrapping them would mangle intentional formatting,
				// and people copy quotes out of them.
				<div className="commitbox-text" aria-label="Commit message">
					{body}
				</div>
			)}
		</div>
	)
}
