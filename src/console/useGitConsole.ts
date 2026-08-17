import { useEffect, useState } from "react"
import { commands, events, type GitConsoleEntry } from "../ipc/bindings"

function capped(next: GitConsoleEntry[], max: number): GitConsoleEntry[] {
	return next.length > max ? next.slice(next.length - max) : next
}

export function useGitConsole(max: number) {
	const [entries, setEntries] = useState<GitConsoleEntry[]>([])

	useEffect(() => {
		let unlisten: (() => void) | undefined
		let cancelled = false
		events.gitConsoleEntry
			.listen((e) => {
				const payload = e.payload
				setEntries((prev) =>
					prev.some((entry) => entry.id === payload.id)
						? prev
						: capped([...prev, payload], max),
				)
			})
			.then((fn) => {
				if (cancelled) {
					fn()
				} else {
					unlisten = fn
				}
			})
		commands.recentConsoleEntries().then((seed) => {
			if (cancelled) {
				return
			}
			setEntries((prev) => {
				const extra = prev.filter(
					(entry) => !seed.some((s) => s.id === entry.id),
				)
				return capped([...seed, ...extra], max)
			})
		})
		return () => {
			cancelled = true
			unlisten?.()
		}
	}, [max])

	return { entries, clear: () => setEntries([]) }
}
