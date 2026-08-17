import { useCallback, useEffect, useState } from "react"
import {
	commands,
	type RepoRefs,
	type Stash,
	type Worktree,
} from "../ipc/bindings"

/**
 * `reloadToken` — bump it to re-read refs in place. `reload` never clears the
 * current values first, so an unchanged branch list produces no visible change:
 * the sidebar used to be remounted for this, which dropped it back to "Loading…"
 * for a frame on every mutation.
 */
export function useRepoRefs(repoPath: string, reloadToken = 0) {
	const [refs, setRefs] = useState<RepoRefs | null>(null)
	const [worktrees, setWorktrees] = useState<Worktree[]>([])
	const [stashes, setStashes] = useState<Stash[]>([])
	const [error, setError] = useState<string | null>(null)

	const reload = useCallback(async () => {
		const [r, w, s] = await Promise.all([
			commands.listRefs(repoPath),
			commands.listWorktrees(repoPath),
			commands.listStashes(repoPath),
		])
		if (r.status === "ok") {
			setRefs(r.data)
			setError(null)
		} else {
			setError(
				"NonZero" in r.error ? r.error.NonZero.stderr : "Failed to read refs",
			)
		}
		if (w.status === "ok") {
			setWorktrees(w.data)
		}
		if (s.status === "ok") {
			setStashes(s.data)
		}
	}, [repoPath])

	useEffect(() => {
		reload()
	}, [reload, reloadToken])

	return { refs, worktrees, stashes, error, reload }
}
