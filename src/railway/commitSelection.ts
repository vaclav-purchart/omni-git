/**
 * Multi-selection over the commit list.
 *
 * Kept separate from the file-list equivalent because the identity is different:
 * a commit is one hash, with no section to disambiguate it, and the order that
 * matters is the log's own order rather than anything the view computes.
 */

/** Toggles one hash, returning a new set. */
export function toggleHash(
	selected: ReadonlySet<string>,
	hash: string,
): Set<string> {
	const next = new Set(selected)
	if (!next.delete(hash)) {
		next.add(hash)
	}
	return next
}

/**
 * The hashes between `from` and `to` inclusive, in log order.
 *
 * `from` is the anchor, which may be after `to` when the range was dragged
 * upwards; the result is ordered by position in the log either way, so callers
 * never have to re-sort. An anchor that isn't in the list (nothing selected yet,
 * or a commit that has since scrolled out of the loaded pages) yields just the
 * clicked one.
 */
export function hashRange(
	hashes: readonly string[],
	from: string | null,
	to: string,
): string[] {
	const toIndex = hashes.indexOf(to)
	if (toIndex === -1) {
		return []
	}
	const fromIndex = from === null ? -1 : hashes.indexOf(from)
	if (fromIndex === -1) {
		return [to]
	}
	const [lo, hi] =
		fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
	return hashes.slice(lo, hi + 1)
}

/**
 * The selection in log order, dropping hashes that are no longer loaded.
 *
 * The list grows by pagination and is rebuilt by every reload, so a selection can
 * outlive the rows it named. Anything not currently present is dropped rather
 * than reported at a stale position.
 */
export function orderedSelection(
	hashes: readonly string[],
	selected: ReadonlySet<string>,
): string[] {
	if (selected.size === 0) {
		return []
	}
	return hashes.filter((h) => selected.has(h))
}
