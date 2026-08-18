import type { WorkingSection } from "../ipc/bindings"
import { type FileRow, rowKey } from "./FileList"

/** Paths in the selection, grouped by the section they live in. */
export type SelectionBySection = Record<WorkingSection, string[]>

const EMPTY: SelectionBySection = {
	Conflicted: [],
	Staged: [],
	Unstaged: [],
	Untracked: [],
}

/**
 * Splits a set of row keys back into per-section path lists, keeping only rows
 * that still exist.
 *
 * The filter matters: a selection outlives the reload that follows every
 * mutation, and a path that got staged has MOVED to another section. Acting on
 * the stale key would ask git to unstage something that isn't staged.
 *
 * Order follows the on-screen order within each section rather than the order
 * the keys were added, so the command line reads the way the list looks.
 */
export function selectionBySection(
	selected: ReadonlySet<string>,
	sections: { key: WorkingSection; paths: string[] }[],
): SelectionBySection {
	if (selected.size === 0) {
		return EMPTY
	}
	const out: SelectionBySection = {
		Conflicted: [],
		Staged: [],
		Unstaged: [],
		Untracked: [],
	}
	for (const { key, paths } of sections) {
		out[key] = paths.filter((p) => selected.has(rowKey(key, p)))
	}
	return out
}

export function selectionSize(by: SelectionBySection): number {
	return (
		by.Conflicted.length +
		by.Staged.length +
		by.Unstaged.length +
		by.Untracked.length
	)
}

/**
 * What can be done to a selection, and to how many of its files.
 *
 * A selection can span sections — staging a mix of modified and brand-new files
 * is a normal thing to want — so each action reports its own count rather than
 * the actions being mutually exclusive. Zero means the action doesn't apply and
 * shouldn't be offered.
 */
export type SelectionActions = {
	/** Modified tracked files plus untracked ones: `git add` handles both. */
	stage: string[]
	unstage: string[]
	/** Tracked edits only — an untracked file has nothing to restore to. */
	discard: string[]
	/** Untracked files, which are deleted rather than reverted. */
	remove: string[]
}

export function selectionActions(by: SelectionBySection): SelectionActions {
	return {
		stage: [...by.Unstaged, ...by.Untracked],
		unstage: by.Staged,
		discard: by.Unstaged,
		remove: by.Untracked,
	}
}

/** Toggles one row in a selection, returning a new set. */
export function toggleRow(
	selected: ReadonlySet<string>,
	section: string,
	path: string,
): Set<string> {
	const next = new Set(selected)
	const key = rowKey(section, path)
	if (!next.delete(key)) {
		next.add(key)
	}
	return next
}

export function rowsToKeys(rows: FileRow[]): Set<string> {
	return new Set(rows.map((r) => rowKey(r.section, r.path)))
}
