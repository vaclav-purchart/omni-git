import { parseRef } from "../railway/refKind"
import { buildRefMenu, type RefActions } from "../refs/refMenu"
import type { MenuItem } from "../ui/ContextMenu"
import "../ui/refBadge.css"
import "./CommitRefs.css"

/**
 * The branches and tags pointing at the selected commit, shown above its files.
 *
 * The railway already draws these badges, but only on the row — which is often
 * scrolled away by the time you are reading the commit, and is not where you are
 * looking when you want the tag's name. One line, only when there is something to
 * put on it.
 *
 * The badges carry the same right-click menu as everywhere else, so copying a tag
 * name works here exactly as it does in the sidebar.
 */
export function CommitRefs({
	refs,
	hash,
	actions,
	onOpenMenu,
}: {
	/** Raw decorations from the log, e.g. `HEAD -> refs/heads/main`. */
	refs: string[]
	/** The commit they point at, which is what the ref menu acts on. */
	hash: string
	actions?: RefActions
	onOpenMenu: (items: MenuItem[], e: React.MouseEvent) => void
}) {
	if (refs.length === 0) {
		return null
	}
	return (
		<div className="commit-refs-row">
			{refs.map((r) => {
				const parsed = parseRef(r)
				return (
					// A span, not a button: these are labels that happen to have a
					// context menu, and making them focusable would put a tab stop
					// between the subject and the file list for every ref on the commit.
					<span
						key={r}
						className={`commit-ref ref-${parsed.kind} ${parsed.isHead ? "is-head" : ""}`}
						title={r}
						onContextMenu={(e) => {
							// A bare `HEAD` names no ref, so there is nothing to act on.
							if (parsed.kind === "head") {
								return
							}
							e.preventDefault()
							onOpenMenu(
								buildRefMenu(
									{ name: parsed.label, tip: hash, kind: parsed.kind },
									actions ?? {},
								),
								e,
							)
						}}
					>
						{parsed.label}
					</span>
				)
			})}
		</div>
	)
}
