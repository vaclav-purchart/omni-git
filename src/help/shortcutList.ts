/**
 * Every keyboard shortcut in the app, as data.
 *
 * A hand-written list is a maintenance risk — it can drift from the code — but
 * the alternative (deriving it from the handlers) would mean routing every
 * keydown through a registry, which is a much bigger change than a help panel
 * warrants. Adding a shortcut means adding a line here.
 *
 * `keys` uses the mac notation and is rewritten for other platforms at render
 * time, so each shortcut is written once.
 */
export type Shortcut = {
	keys: string
	description: string
	/** Where it applies — also the grouping in the help panel. */
	context: string
}

export const SHORTCUTS: Shortcut[] = [
	// Global
	{ keys: "⌘⇧P", description: "Open the command palette", context: "Global" },
	{ keys: "⌘R", description: "Refresh the repository", context: "Global" },
	{
		keys: "⌘⇧C",
		description: "Copy the open file's path",
		context: "Global",
	},

	// Command palette
	{ keys: "Enter", description: "Run the command", context: "Command palette" },
	{
		keys: "Tab",
		description: "Complete, then cycle candidates",
		context: "Command palette",
	},
	{
		keys: "↑ ↓",
		description: "Previous / next command from history",
		context: "Command palette",
	},
	{
		keys: "Esc",
		description: "Close without running",
		context: "Command palette",
	},

	// Commit history
	{
		keys: "↑ ↓",
		description: "Previous / next commit",
		context: "Commit history",
	},
	{
		keys: "Home End",
		description: "First / last commit",
		context: "Commit history",
	},
	{
		keys: "⌘↑ ⌘↓",
		description: "First / last commit",
		context: "Commit history",
	},
	{
		keys: "⇧↑ ⇧↓",
		description: "Extend the selection",
		context: "Commit history",
	},
	{
		keys: "⇧Click",
		description: "Select a range of commits",
		context: "Commit history",
	},
	{
		keys: "⌘Click",
		description: "Add or remove one commit from the selection",
		context: "Commit history",
	},
	{
		keys: "Enter",
		description: "Move focus to the file list",
		context: "Commit history",
	},
	{
		keys: "Enter",
		description: "Jump to next search match (Shift for previous)",
		context: "Commit history",
	},

	// File list
	{ keys: "↑ ↓", description: "Previous / next file", context: "File list" },
	{
		keys: "⇧↑ ⇧↓",
		description: "Extend the selection",
		context: "File list",
	},
	{
		keys: "⇧Click",
		description: "Select a range of files",
		context: "File list",
	},
	{
		keys: "⌘Click",
		description: "Add or remove one file from the selection",
		context: "File list",
	},
	{ keys: "Home End", description: "First / last file", context: "File list" },
	{ keys: "⌘↑ ⌘↓", description: "First / last file", context: "File list" },
	{
		keys: "⌘A",
		description: "Select every visible file",
		context: "File list",
	},
	{
		keys: "Enter",
		description: "Move focus to the diff",
		context: "File list",
	},
	{
		keys: "Backspace",
		description: "Back to the commit list",
		context: "File list",
	},

	// Diff
	{ keys: "↑ ↓", description: "Scroll the diff", context: "Diff" },
	{ keys: "Backspace", description: "Back to the file list", context: "Diff" },
	{ keys: "⌘F", description: "Find in the open diff", context: "Diff" },
	{
		keys: "Enter",
		description: "Next match (Shift for previous)",
		context: "Diff",
	},
	{ keys: "Esc", description: "Close the diff search", context: "Diff" },

	// Commit box
	{
		keys: "⌘Enter",
		description: "Commit (from inside the message box)",
		context: "Commit box",
	},
	{
		keys: "⌘Enter",
		description: "Jump to the message box (from elsewhere in the panel)",
		context: "Commit box",
	},

	// Dialogs and menus
	{
		keys: "Esc",
		description: "Close the command output panel",
		context: "Dialogs",
	},
	{ keys: "Esc", description: "Close a context menu", context: "Dialogs" },
	{ keys: "Esc", description: "Cancel a confirmation", context: "Dialogs" },
	{
		keys: "↑ ↓",
		description: "Move through a context menu",
		context: "Dialogs",
	},
]

/**
 * Rewrites mac symbols for other platforms. Kept here so the list itself stays
 * written once, in one notation.
 */
export function formatKeys(keys: string, isMac: boolean): string {
	if (isMac) {
		return keys
	}
	return keys
		.replace(/⌘/g, "Ctrl+")
		.replace(/⇧/g, "Shift+")
		.replace(/⌥/g, "Alt+")
}

/** Case-insensitive match over keys, description and context. */
export function matchesShortcut(s: Shortcut, query: string): boolean {
	const q = query.trim().toLowerCase()
	if (q === "") {
		return true
	}
	return (
		s.keys.toLowerCase().includes(q) ||
		s.description.toLowerCase().includes(q) ||
		s.context.toLowerCase().includes(q)
	)
}

/** Shortcuts matching `query`, grouped by context, preserving list order. */
export function groupShortcuts(
	query: string,
	isMac: boolean,
): Array<{ context: string; items: Shortcut[] }> {
	const groups: Array<{ context: string; items: Shortcut[] }> = []
	for (const s of SHORTCUTS) {
		// Search the DISPLAYED keys, so a Windows user searching "ctrl" finds them.
		const displayed = { ...s, keys: formatKeys(s.keys, isMac) }
		if (!matchesShortcut(displayed, query)) {
			continue
		}
		const existing = groups.find((g) => g.context === s.context)
		if (existing) {
			existing.items.push(displayed)
		} else {
			groups.push({ context: s.context, items: [displayed] })
		}
	}
	return groups
}
