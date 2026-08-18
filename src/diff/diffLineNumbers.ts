import type { Extension } from "@codemirror/state"
import { StateField } from "@codemirror/state"
import { type EditorView, GutterMarker, gutter } from "@codemirror/view"

export type LineNos = { old: number | null; new: number | null }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
/**
 * A COMBINED hunk header, as `git diff` produces for an unmerged path:
 * `@@@ -1,3 -1,3 +1,7 @@@`. One `-` range per parent, and one more `@` than a
 * two-way header. Without this the header was read as a context line, which left
 * every number in a conflicted file counting up from zero.
 */
const COMBINED_HUNK = /^@{3,} ((?:-\d+(?:,\d+)? )+)\+(\d+)(?:,\d+)? @{3,}/
const META =
	/^(\+\+\+|---|diff |index |new file|deleted file|rename |similarity |copy |\\)/

/**
 * Maps each line of a unified diff to its source line numbers (old side / new
 * side), reading positions from the `@@` hunk headers. Meta/header and hunk
 * lines get `{null, null}`. Pure — one entry per input line.
 *
 * Handles combined diffs too (conflicted files). There the new side numbers the
 * merged result, and the old side follows the FIRST parent — ours/HEAD during a
 * merge, which is the side being reconciled against. The other parents get no
 * gutter of their own; there are only two.
 */
export function computeLineNumbers(text: string): LineNos[] {
	const out: LineNos[] = []
	let oldLn = 0
	let newLn = 0
	// 0 while reading a two-way diff; otherwise the parent count, which is also
	// the width of each line's prefix.
	let parents = 0
	for (const line of text.split("\n")) {
		const combined = line.match(COMBINED_HUNK)
		if (combined) {
			const ranges = combined[1].trim().split(" ")
			parents = ranges.length
			oldLn = Number.parseInt(ranges[0].slice(1), 10)
			newLn = Number.parseInt(combined[2], 10)
			out.push({ old: null, new: null })
			continue
		}
		const hunk = line.match(HUNK)
		if (hunk) {
			parents = 0
			oldLn = Number.parseInt(hunk[1], 10)
			newLn = Number.parseInt(hunk[2], 10)
			out.push({ old: null, new: null })
			continue
		}
		if (META.test(line)) {
			out.push({ old: null, new: null })
			continue
		}
		if (parents > 0) {
			// Each prefix column says how the line relates to one parent: `-` present
			// there but not in the result, `+` the reverse, a space in both. A line
			// never mixes the two, so any `-` means it is absent from the merge.
			const prefix = line.slice(0, parents)
			const inResult = !prefix.includes("-")
			const inFirstParent = prefix[0] !== "+"
			out.push({
				old: inFirstParent ? oldLn : null,
				new: inResult ? newLn : null,
			})
			if (inFirstParent) {
				oldLn++
			}
			if (inResult) {
				newLn++
			}
			continue
		}
		if (line.startsWith("+")) {
			out.push({ old: null, new: newLn })
			newLn++
		} else if (line.startsWith("-")) {
			out.push({ old: oldLn, new: null })
			oldLn++
		} else {
			// context (leading space) or blank line within a hunk
			out.push({ old: oldLn, new: newLn })
			oldLn++
			newLn++
		}
	}
	return out
}

const lineNoField = StateField.define<LineNos[]>({
	create: (state) => computeLineNumbers(state.doc.toString()),
	update: (value, tr) =>
		tr.docChanged ? computeLineNumbers(tr.newDoc.toString()) : value,
})

class NumberMarker extends GutterMarker {
	constructor(readonly num: number) {
		super()
	}
	eq(other: NumberMarker) {
		return other.num === this.num
	}
	toDOM() {
		return document.createTextNode(String(this.num))
	}
}

function sideGutter(side: "old" | "new"): Extension {
	return gutter({
		class: `cm-diff-lineno cm-diff-lineno-${side}`,
		lineMarker(view: EditorView, line) {
			const nums = view.state.field(lineNoField, false)
			if (!nums) {
				return null
			}
			const lineNumber = view.state.doc.lineAt(line.from).number
			const entry = nums[lineNumber - 1]
			const n = entry ? entry[side] : null
			return n == null ? null : new NumberMarker(n)
		},
		lineMarkerChange: (update) => update.docChanged,
	})
}

// Two gutters: old line numbers, then new line numbers.
export const diffLineNumbers: Extension = [
	lineNoField,
	sideGutter("old"),
	sideGutter("new"),
]
