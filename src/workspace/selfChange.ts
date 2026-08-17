/**
 * Suppresses the FS-watcher echo of a change we made ourselves.
 *
 * Every mutation reloads the views immediately, and then the `.git` write it
 * caused reaches the debounced watcher a moment later and asks for a second
 * reload of data we already just read. Since the reload no longer remounts
 * anything the extra pass is invisible, but it's still a full round of git
 * commands for nothing.
 *
 * Safe because our own reload happens AFTER the mutation completed, so it
 * already observed the post-mutation state. An unrelated external change landing
 * inside the window is likewise covered — the same reload read it.
 */
export const SELF_CHANGE_WINDOW_MS = 750

export type SelfChange = { until: number }

export const initialSelfChange: SelfChange = { until: 0 }

/** Call when WE change the repo, to open the suppression window. */
export function markSelfChange(now: number): SelfChange {
	return { until: now + SELF_CHANGE_WINDOW_MS }
}

/** Whether a watcher event arriving at `now` is our own echo. */
export function isSelfChangeEcho(state: SelfChange, now: number): boolean {
	return now < state.until
}
