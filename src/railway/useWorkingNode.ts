import { useEffect, useState } from "react"
import { type CommitSummary, commands } from "../ipc/bindings"
import { makeWorkingNode, type WorkingCounts } from "./working"

/**
 * `reloadToken` — bump to re-read the working counts in place.
 *
 * The state is cleared only when the REPO changes. A reload leaves the pinned
 * "Uncommitted changes" row on screen until the new counts arrive; clearing
 * first made the row vanish and reappear on every stage/unstage, which read as
 * the railway blinking.
 */
export function useWorkingNode(
	repoPath: string,
	reloadToken = 0,
): {
	node: CommitSummary | null
	counts: WorkingCounts | null
} {
	const [node, setNode] = useState<CommitSummary | null>(null)
	const [counts, setCounts] = useState<WorkingCounts | null>(null)

	useEffect(() => {
		setNode(null)
		setCounts(null)
	}, [repoPath])

	useEffect(() => {
		let cancelled = false
		commands
			.workingStatus(repoPath)
			.then((result) => {
				if (cancelled) {
					return
				}
				if (result.status !== "ok") {
					return
				}
				const { staged, unstaged, untracked } = result.data
				const total = staged.length + unstaged.length + untracked.length
				if (total === 0) {
					// A genuinely clean tree: the row must go away.
					setNode(null)
					setCounts(null)
					return
				}
				// Keep the existing node object so its identity is stable across
				// reloads and consumers don't re-render for nothing.
				setNode((prev) => prev ?? makeWorkingNode())
				setCounts({
					staged: staged.length,
					unstaged: unstaged.length,
					untracked: untracked.length,
				})
			})
			.catch(() => {
				// Working status is best-effort decoration; swallow failures (e.g.
				// no Tauri IPC available) rather than surfacing an error UI.
			})
		return () => {
			cancelled = true
		}
	}, [repoPath, reloadToken])

	return { node, counts }
}
