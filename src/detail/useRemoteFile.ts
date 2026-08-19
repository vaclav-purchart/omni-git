import { useCallback, useEffect, useState } from "react"
import { commands } from "../ipc/bindings"
import { webUrlFor } from "./remoteFileUrl"

/**
 * Everything needed to offer a browsable link to a file at one commit: a URL
 * builder for a path, and whether that commit is on a remote at all.
 *
 * Both answers are fetched EAGERLY, when the commit is selected, rather than on
 * right-click. A context menu has to open instantly, and `git branch -r
 * --contains` is a rev-walk — asking for it at click time would either stall the
 * menu or arrive after it was drawn.
 */
export function useRemoteFile(repoPath: string, sha: string | null) {
	const [remote, setRemote] = useState<string | null>(null)
	const [pushed, setPushed] = useState<boolean | null>(null)

	// Per repo: the configured remote only changes when the repository does.
	useEffect(() => {
		let cancelled = false
		commands.remoteUrl(repoPath).then((r) => {
			if (!cancelled) {
				setRemote(r.status === "ok" ? r.data : null)
			}
		})
		return () => {
			cancelled = true
		}
	}, [repoPath])

	// Per commit. Reset to null first so the menu never shows a previous commit's
	// answer while this one is in flight.
	useEffect(() => {
		if (sha === null) {
			setPushed(null)
			return
		}
		let cancelled = false
		setPushed(null)
		commands.commitOnRemote(repoPath, sha).then((r) => {
			if (!cancelled) {
				setPushed(r.status === "ok" ? r.data : null)
			}
		})
		return () => {
			cancelled = true
		}
	}, [repoPath, sha])

	const urlFor = useCallback(
		(path: string) =>
			remote === null || sha === null ? null : webUrlFor(remote, sha, path),
		[remote, sha],
	)

	return { urlFor, pushed }
}
