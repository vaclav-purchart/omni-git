import { useCallback } from "react"
import { usePersistentState } from "../ui/usePersistentState"

// Enough to arrow back through a working session without the list becoming a
// haystack.
const MAX_HISTORY = 50

/**
 * Command-palette history, newest first, persisted PER REPO — `checkout` targets
 * and paths are repo-specific, so a shared list would mostly offer commands that
 * don't apply here.
 */
export function useCommandHistory(repoPath: string) {
	const [history, setHistory] = usePersistentState<string[]>(
		`command-history:${repoPath}`,
		[],
	)

	const remember = useCallback(
		(command: string) => {
			const trimmed = command.trim()
			if (trimmed === "") {
				return
			}
			setHistory((prev) => {
				const previous = Array.isArray(prev) ? prev : []
				// Re-running something moves it to the front rather than duplicating,
				// so arrowing back doesn't walk over repeats of the same command.
				const withoutDupe = previous.filter((c) => c !== trimmed)
				return [trimmed, ...withoutDupe].slice(0, MAX_HISTORY)
			})
		},
		[setHistory],
	)

	// Defensive: the value is persisted, so a hand-edited or older payload could
	// be the wrong shape.
	const safe = Array.isArray(history)
		? history.filter((c): c is string => typeof c === "string")
		: []

	return { history: safe, remember }
}
