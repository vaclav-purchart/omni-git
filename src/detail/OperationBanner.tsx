import { Warning } from "@phosphor-icons/react"
import type { OperationAction, RepoOperation } from "../ipc/bindings"
import "./OperationBanner.css"

/** What each operation is called in prose. */
const NAMES: Record<string, string> = {
	Merge: "Merge",
	Rebase: "Rebase",
	CherryPick: "Cherry-pick",
	Revert: "Revert",
	Apply: "Patch series",
}

/**
 * Says what the repo is in the middle of, and offers the way out.
 *
 * A conflicted repo is a mode, not a state of one file: most actions will refuse
 * until it is resolved, and the only exits are continue / abort / skip. Without
 * this the app looked normal while nothing worked.
 */
export function OperationBanner({
	operation,
	busy = false,
	onAction,
}: {
	operation: RepoOperation
	busy?: boolean
	onAction: (action: OperationAction) => void
}) {
	if (operation.kind === null) {
		return null
	}
	const name = NAMES[operation.kind] ?? operation.kind
	const n = operation.conflicts.length
	const step = operation.step
	// A rebase stopped with nothing unmerged is a real state — an `edit` step, or
	// a hook that refused — and reads very differently from a conflict.
	const detail =
		n > 0
			? `${n} conflicted file${n === 1 ? "" : "s"} to resolve`
			: "no conflicts — ready to continue"

	return (
		<div className="op-banner" role="status">
			<Warning className="op-banner-icon" aria-hidden="true" />
			<div className="op-banner-text">
				<span className="op-banner-title">
					{name} in progress
					{operation.head_name !== null && ` on ${operation.head_name}`}
					{step !== null && ` · step ${step[0]} of ${step[1]}`}
				</span>
				<span className="op-banner-detail">{detail}</span>
			</div>
			<div className="op-banner-actions">
				<button
					type="button"
					className="op-banner-btn"
					disabled={busy || n > 0}
					title={
						n > 0
							? "Resolve the conflicts and stage them first"
							: `Continue the ${name.toLowerCase()}`
					}
					onClick={() => onAction("Continue")}
				>
					Continue
				</button>
				{operation.can_skip && (
					<button
						type="button"
						className="op-banner-btn"
						disabled={busy}
						title="Drop this commit and move to the next one"
						onClick={() => onAction("Skip")}
					>
						Skip
					</button>
				)}
				<button
					type="button"
					className="op-banner-btn is-danger"
					disabled={busy}
					title={`Undo the whole ${name.toLowerCase()} and go back`}
					onClick={() => onAction("Abort")}
				>
					Abort
				</button>
			</div>
		</div>
	)
}
