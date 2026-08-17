import type { Extension } from "@codemirror/state"
import { RangeSetBuilder } from "@codemirror/state"
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view"

export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context"

export function classifyDiffLine(line: string): DiffLineKind {
	if (line.startsWith("@@")) {
		return "hunk"
	}
	if (
		line.startsWith("+++") ||
		line.startsWith("---") ||
		line.startsWith("diff ") ||
		line.startsWith("index ") ||
		line.startsWith("new file") ||
		line.startsWith("deleted file") ||
		line.startsWith("rename ")
	) {
		return "meta"
	}
	if (line.startsWith("+")) {
		return "add"
	}
	if (line.startsWith("-")) {
		return "del"
	}
	return "context"
}

const lineDeco: Record<Exclude<DiffLineKind, "context">, Decoration> = {
	add: Decoration.line({ class: "cm-diff-add" }),
	del: Decoration.line({ class: "cm-diff-del" }),
	hunk: Decoration.line({ class: "cm-diff-hunk" }),
	meta: Decoration.line({ class: "cm-diff-meta" }),
}

function build(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>()
	for (const { from, to } of view.visibleRanges) {
		let pos = from
		while (pos <= to) {
			const line = view.state.doc.lineAt(pos)
			const kind = classifyDiffLine(line.text)
			if (kind !== "context") {
				builder.add(line.from, line.from, lineDeco[kind])
			}
			pos = line.to + 1
		}
	}
	return builder.finish()
}

export const diffHighlighter: Extension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet
		constructor(view: EditorView) {
			this.decorations = build(view)
		}
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged) {
				this.decorations = build(u.view)
			}
		}
	},
	{ decorations: (v) => v.decorations },
)
