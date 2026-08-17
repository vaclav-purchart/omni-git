/**
 * Matching for the sidebar's ref filter.
 *
 * Two ways to match, in order of how strongly they mean "this is what I meant":
 *
 * 1. A substring, anywhere in the name. Branch names are paths —
 *    `feature/JIRA-4821-retry-logic` — and the part anyone remembers is in the
 *    middle, so prefix matching would be nearly useless here.
 * 2. A subsequence: the query's characters appearing in order but not adjacent,
 *    so `j4821retry` finds the branch above. Only consulted when nothing matched
 *    as a substring, because on its own it matches far too much to be a useful
 *    first answer.
 */

/** Whether every character of `query` appears in `text`, in order. */
export function isSubsequence(text: string, query: string): boolean {
	let i = 0
	for (const ch of text) {
		if (ch === query[i]) {
			i++
			if (i === query.length) {
				return true
			}
		}
	}
	return query.length === 0
}

export type MatchKind = "substring" | "subsequence"

/**
 * How `name` matches `query`, or null if it doesn't.
 *
 * The kind is returned rather than a bare boolean so the caller can prefer the
 * stronger one across a whole list — see `filterNames`.
 */
export function matchRef(name: string, query: string): MatchKind | null {
	const q = query.trim().toLowerCase()
	if (q === "") {
		return "substring"
	}
	const n = name.toLowerCase()
	if (n.includes(q)) {
		return "substring"
	}
	// Spaces are how people separate the parts they remember ("feat retry"), so a
	// query with them is matched part by part rather than literally.
	const parts = q.split(/\s+/).filter((p) => p !== "")
	if (parts.length > 1 && parts.every((p) => n.includes(p))) {
		return "substring"
	}
	return isSubsequence(n, q) ? "subsequence" : null
}

/**
 * The names matching `query`, in their original order.
 *
 * Order is preserved deliberately: the sidebar is a place people navigate by
 * memory, and re-sorting by score would move a branch out from under the cursor
 * between keystrokes.
 *
 * If anything matched as a substring, the looser subsequence matches are dropped
 * entirely. Mixing them buries the obvious answer among incidental ones — typing
 * `main` should not also offer `my-feature/admin-panel`.
 */
export function filterNames<T>(
	items: readonly T[],
	nameOf: (item: T) => string,
	query: string,
): T[] {
	if (query.trim() === "") {
		return [...items]
	}
	const matched = items
		.map((item) => ({ item, kind: matchRef(nameOf(item), query) }))
		.filter((m) => m.kind !== null)
	const strong = matched.filter((m) => m.kind === "substring")
	return (strong.length > 0 ? strong : matched).map((m) => m.item)
}
