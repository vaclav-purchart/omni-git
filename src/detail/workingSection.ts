import type { WorkingSection } from "../ipc/bindings"

const KNOWN: WorkingSection[] = [
	"Conflicted",
	"Staged",
	"Unstaged",
	"Untracked",
]

/**
 * Narrows a `FileList` section key to a `WorkingSection`.
 *
 * `FileList` speaks in plain-string keys because its other users — commit, stash
 * and compare file lists — have keys that are not working-copy sections at all
 * (`"changed"`, `"stashed"`). That made this boundary a cast, and a cast is what
 * let `"Conflicted"` be handed to a backend with no such variant: the command
 * failed to deserialize, the failure was mapped to an empty string, and a
 * conflicted file rendered as a blank pane with no explanation.
 *
 * Returning null rather than throwing: the section keys are checked at their
 * declaration too (`satisfies WorkingSection`), so an unknown one here is already
 * impossible — this is the runtime half of that guarantee, not error handling.
 */
export function asWorkingSection(key: string): WorkingSection | null {
	for (const known of KNOWN) {
		if (known === key) {
			return known
		}
	}
	return null
}
