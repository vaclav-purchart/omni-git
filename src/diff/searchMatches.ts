/**
 * Finding and stepping through matches in the diff text.
 *
 * Plain string scanning over the document rather than CodeMirror's `SearchCursor`:
 * the bar needs a COUNT ("3/17"), and a cursor only iterates. Keeping it pure also
 * means the stepping and wrap-around rules are testable without an editor.
 */

export type Match = { from: number; to: number }

/**
 * Upper bound on collected matches.
 *
 * A one-character query against a large diff would otherwise build a huge array to
 * render a number nobody reads. The count says "5000+" past this point.
 */
export const MATCH_LIMIT = 5000

/**
 * Every occurrence of `query` in `text`, in document order, case-insensitively.
 *
 * Literal, never a regex: a diff is full of `+`, `-`, `@@` and `.`, and those must
 * match themselves. Matches never overlap — after a hit, scanning resumes at its
 * end, so `aa` in `aaaa` is two matches rather than three.
 */
export function findMatches(text: string, query: string): Match[] {
	const needle = query.trim().toLowerCase()
	if (needle === "") {
		return []
	}
	const haystack = text.toLowerCase()
	const out: Match[] = []
	let at = haystack.indexOf(needle)
	while (at !== -1 && out.length < MATCH_LIMIT) {
		out.push({ from: at, to: at + needle.length })
		at = haystack.indexOf(needle, at + needle.length)
	}
	return out
}

/**
 * The next index in `count` matches, `delta` steps from `current`, wrapping.
 *
 * `current` is -1 when nothing is selected yet, which is the state the bar opens
 * in. Stepping forward from there picks the first match and backward the last, so
 * the first press of next/prev never skips one.
 */
export function stepIndex(
	current: number,
	count: number,
	delta: number,
): number {
	if (count === 0) {
		return -1
	}
	if (current < 0) {
		return delta > 0 ? 0 : count - 1
	}
	return (current + delta + count) % count
}

/**
 * The first match starting at or after `pos`, wrapping to 0 past the last one.
 *
 * Used when the query changes: keeping the selection near where the user already
 * is beats snapping back to the top of the file on every keystroke.
 */
export function matchIndexAt(matches: Match[], pos: number): number {
	if (matches.length === 0) {
		return -1
	}
	const found = matches.findIndex((m) => m.from >= pos)
	return found === -1 ? 0 : found
}
