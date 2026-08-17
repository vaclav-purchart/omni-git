/**
 * Splits a patch into its git preamble and the actual changes.
 *
 * The preamble — `diff --git`, `index`, mode/rename lines, `---`/`+++` — is
 * plumbing. The file path and the +/− counts it restates are already in the diff
 * view's own header, so on screen it is several lines of noise before the thing
 * you opened the file to read.
 *
 * The split is the first hunk marker: everything from `@@` onwards is content.
 */
export type SplitPatch = { header: string; body: string }

export function splitPatchHeader(diff: string): SplitPatch {
	const lines = diff.split("\n")
	const firstHunk = lines.findIndex((line) => line.startsWith("@@"))
	// `< 0`: no hunks at all — a binary placeholder, a pure rename, an empty
	// patch. `=== 0`: already starts at the changes. In both cases there is
	// nothing to fold away, and for a rename-only patch the preamble IS the
	// information, so it must stay visible.
	if (firstHunk <= 0) {
		return { header: "", body: diff }
	}
	return {
		header: lines.slice(0, firstHunk).join("\n"),
		body: lines.slice(firstHunk).join("\n"),
	}
}
