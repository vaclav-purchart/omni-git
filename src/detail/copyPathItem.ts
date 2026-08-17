import type { MenuItem } from "../ui/ContextMenu"
import { copyPathShortcutLabel, isMacPlatform } from "../workspace/shortcuts"

/**
 * The "Copy Path To Clipboard" menu item, shared by every file list.
 *
 * One definition rather than three, so the label, the shortcut hint and the
 * clipboard call can't drift between the working copy, a commit and a compare —
 * and so the hint stays in step with the handler that actually implements it
 * (`isCopyPathShortcut`, wired at the workspace level).
 */
export function copyPathItem(path: string): MenuItem {
	return {
		type: "item",
		label: "Copy Path To Clipboard",
		shortcut: copyPathShortcutLabel(isMacPlatform()),
		onClick: () => {
			navigator.clipboard?.writeText(path).catch(() => {})
		},
	}
}
