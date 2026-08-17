/**
 * Global keyboard shortcuts for the workspace.
 *
 * Pure predicates over the event so they can be tested without a DOM, and so the
 * modifier rules live in one place rather than as growing inline conditions.
 *
 * They match on `code` (physical key) rather than `key`: with modifiers held,
 * `key` varies by layout and by which modifiers are down (Shift+p gives "P"),
 * while `code` stays "KeyP".
 */
export type ShortcutEvent = {
	code: string
	metaKey: boolean
	ctrlKey: boolean
	shiftKey: boolean
	altKey: boolean
}

/** Cmd/Ctrl, and neither Shift nor Alt — so combinations stay distinct. */
function isPlainCmdOrCtrl(e: ShortcutEvent): boolean {
	return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
}

/** Cmd/Ctrl+Shift+P — the command palette. */
export function isPaletteShortcut(e: ShortcutEvent): boolean {
	return (
		(e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyP"
	)
}

/**
 * Cmd/Ctrl+R — re-read the repo, same as the ↻ button.
 *
 * The handler must `preventDefault()`: this is the browser's reload accelerator,
 * and reloading the webview would throw away the whole session rather than
 * refreshing the data. (Tauri's default menu doesn't claim Cmd+R, so preventing
 * the default is enough.)
 */
export function isRefreshShortcut(e: ShortcutEvent): boolean {
	return isPlainCmdOrCtrl(e) && e.code === "KeyR"
}

/**
 * Cmd/Ctrl+Shift+C — copy the open file's path.
 *
 * Shift is what keeps it clear of Cmd/Ctrl+C, which has to stay the ordinary
 * copy: taking that over would break copying a selected line out of a diff.
 */
export function isCopyPathShortcut(e: ShortcutEvent): boolean {
	return (
		(e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "KeyC"
	)
}

/**
 * Best-effort platform check, used only to label shortcuts. `navigator.platform`
 * is deprecated but still the most reliable signal in a webview; the user-agent
 * is the fallback.
 */
export function isMacPlatform(): boolean {
	const nav: { platform?: string; userAgent?: string } =
		typeof navigator === "undefined" ? {} : navigator
	return /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent || "")
}

/** Label for the shortcut, in the platform's notation. */
export function refreshShortcutLabel(isMac: boolean): string {
	return isMac ? "⌘R" : "Ctrl+R"
}

/**
 * Label for commit, in the platform's notation.
 *
 * Says "from the message box" because that is the truth: the shortcut commits
 * only while the textarea has focus. From elsewhere in the panel the same keys
 * jump TO the box instead, and a tooltip promising a commit would be wrong half
 * the time.
 */
export function commitShortcutLabel(isMac: boolean): string {
	return isMac ? "⌘Enter" : "Ctrl+Enter"
}

/**
 * Label for copy-path, in the platform's notation.
 *
 * Shown in the context menu next to the item it triggers — a shortcut nobody can
 * discover is a shortcut nobody uses.
 */
export function copyPathShortcutLabel(isMac: boolean): string {
	return isMac ? "⌘⇧C" : "Ctrl+Shift+C"
}
