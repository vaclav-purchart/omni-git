// Focus-gating for watcher-driven refreshes.
//
// The `.git` FS watcher keeps running while the window is unfocused, but
// refreshing the UI (re-running git queries + remounting panels) for a window
// nobody is looking at is wasted work. So while unfocused we DEFER: a
// repo-changed event only marks the view dirty (`pending`); the actual refresh
// happens once when focus returns. Manual ↻ and post-mutation refreshes are
// explicit user actions and bypass this gate entirely.

export type FocusGate = { focused: boolean; pending: boolean }

export const initialFocusGate: FocusGate = { focused: true, pending: false }

export type GateDecision = { refreshNow: boolean; gate: FocusGate }

/** A repo-changed event arrived: refresh now if focused, else defer. */
export function onRepoChanged(gate: FocusGate): GateDecision {
	if (gate.focused) {
		return { refreshNow: true, gate }
	}
	return { refreshNow: false, gate: { ...gate, pending: true } }
}

/**
 * Window focus changed.
 *
 * Regaining focus ALWAYS refreshes, not only when a `.git` event was deferred:
 * the watcher only sees `.git`, so editing a file in an editor produces no event
 * at all and the working view would stay stale until the user pressed ↻. Coming
 * back to the window is exactly the moment they expect current data, and since
 * panels reload in place an unchanged repo produces no visible change.
 *
 * Only on the false → true TRANSITION, so a spurious "focused" event (one arrives
 * when the window is first shown) doesn't duplicate the initial load.
 */
export function onFocusChange(gate: FocusGate, focused: boolean): GateDecision {
	if (focused && !gate.focused) {
		return { refreshNow: true, gate: { focused: true, pending: false } }
	}
	return { refreshNow: false, gate: { focused, pending: gate.pending } }
}
