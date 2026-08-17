import { commands } from "../ipc/bindings"

/**
 * UI settings, held in memory and persisted to `settings.json` by the backend.
 *
 * Reads are SYNCHRONOUS by design. `initSettings()` runs once before the first
 * render, so the startup path can decide which screen to show without awaiting
 * IPC — that's what keeps the launcher from flashing on the way to a restored
 * repo. Writes go to disk on a short debounce.
 *
 * Replaces `localStorage`, which was keyed by origin (so dev and the bundled app
 * had separate stores — settings looked wiped after a rebuild) and unreadable
 * from Rust, which needs some of these before the webview exists.
 */

// How long to wait before writing. Long enough to collapse a drag's worth of
// panel-resize events, short enough that quitting straight after a change keeps
// it — and `flushSettings` covers the rest.
const SAVE_DEBOUNCE_MS = 200

/** Where those panel layouts live in settings now. */
export const PANEL_KEY_PREFIX = "panels."

let cache: Record<string, string> = {}
let saveTimer: ReturnType<typeof setTimeout> | null = null
let pending = false

/**
 * Loads settings from disk. Must be awaited before the first render, since every
 * read afterwards is synchronous.
 *
 * Never throws: a failure here must not stop the app from starting. Worst case
 * the session runs on defaults.
 */
export async function initSettings(): Promise<void> {
	cache = {}
	try {
		const r = await commands.loadSettings()
		if (r.status === "ok") {
			// The generated binding types a map's values as possibly-undefined, so
			// copy defensively rather than asserting.
			for (const [key, value] of Object.entries(r.data)) {
				if (typeof value === "string") {
					cache[key] = value
				}
			}
		}
	} catch {
		// Leave defaults in place.
	}
}

export function getSetting(key: string): string | null {
	return key in cache ? cache[key] : null
}

export function setSetting(key: string, raw: string): void {
	if (cache[key] === raw) {
		return
	}
	cache[key] = raw
	scheduleSave()
}

export function removeSetting(key: string): void {
	if (!(key in cache)) {
		return
	}
	delete cache[key]
	scheduleSave()
}

function scheduleSave(): void {
	pending = true
	if (saveTimer !== null) {
		clearTimeout(saveTimer)
	}
	saveTimer = setTimeout(() => {
		void flushSettings()
	}, SAVE_DEBOUNCE_MS)
}

/** Writes immediately if anything is pending. */
export async function flushSettings(): Promise<void> {
	if (saveTimer !== null) {
		clearTimeout(saveTimer)
		saveTimer = null
	}
	if (!pending) {
		return
	}
	pending = false
	try {
		await commands.saveSettings({ ...cache })
	} catch {
		// Losing a UI preference is not worth surfacing an error for.
	}
}

/**
 * Storage adapter for react-resizable-panels, which otherwise writes its layouts
 * straight to localStorage and so would keep losing them on rebuild.
 */
export const panelStorage = {
	getItem(name: string): string | null {
		return getSetting(PANEL_KEY_PREFIX + name)
	},
	setItem(name: string, value: string): void {
		setSetting(PANEL_KEY_PREFIX + name, value)
	},
}

/** Test seam: resets the in-memory cache. */
export function __resetSettingsForTests(
	state: Record<string, string> = {},
): void {
	cache = { ...state }
	if (saveTimer !== null) {
		clearTimeout(saveTimer)
		saveTimer = null
	}
	pending = false
}
