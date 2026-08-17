import type { Extension } from "@codemirror/state"
import { StateField } from "@codemirror/state"
import { type EditorView, GutterMarker, gutter } from "@codemirror/view"

export type LineNos = { old: number | null; new: number | null }

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
const META =
	/^(\+\+\+|---|diff |index |new file|deleted file|rename |similarity |copy |\\)/

/**
 * Maps each line of a unified diff to its source line numbers (old side / new
 * side), reading positions from the `@@` hunk headers. Meta/header and hunk
 * lines get `{null, null}`. Pure — one entry per input line.
 */
export function computeLineNumbers(text: string): LineNos[] {
	const out: LineNos[] = []
	let oldLn = 0
	let newLn = 0
	for (const line of text.split("\n")) {
		const hunk = line.match(HUNK)
		if (hunk) {
			oldLn = Number.parseInt(hunk[1], 10)
			newLn = Number.parseInt(hunk[2], 10)
			out.push({ old: null, new: null })
			continue
		}
		if (META.test(line)) {
			out.push({ old: null, new: null })
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
