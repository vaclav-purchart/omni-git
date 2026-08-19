import { openUrl } from "@tauri-apps/plugin-opener"
import type { MenuItem } from "../ui/ContextMenu"

/**
 * "Copy remote file URL" / "Open remote file URL", for a file at a specific
 * commit — a link that can be sent to someone else.
 *
 * Shared by every read-only file list so the wording and the not-pushed handling
 * cannot drift between them. Both items are absent, rather than disabled, when no
 * URL could be built: that means the forge is unknown or the repo has no remote,
 * which is a property of the repository rather than something the user can act on.
 */
export function remoteFileItems({
	url,
	pushed,
}: {
	/** The file's web URL, or null if one could not be built. */
	url: string | null
	/** Whether the commit exists on a remote; null while the check is in flight. */
	pushed: boolean | null
}): MenuItem[] {
	if (url === null) {
		return []
	}
	// Only a definite "no" disables. The check is asynchronous and the menu can
	// open before it lands; staying usable is the better bet, since the common case
	// is a pushed commit and the cost of being wrong is one 404.
	const blocked = pushed === false
	const suffix = blocked ? " (commit not pushed)" : ""
	return [
		{
			type: "item",
			label: `Copy remote file URL${suffix}`,
			disabled: blocked,
			onClick: blocked
				? undefined
				: () => {
						navigator.clipboard?.writeText(url).catch(() => {})
					},
		},
		{
			type: "item",
			label: `Open remote file URL${suffix}`,
			disabled: blocked,
			onClick: blocked ? undefined : () => void openUrl(url),
		},
	]
}
