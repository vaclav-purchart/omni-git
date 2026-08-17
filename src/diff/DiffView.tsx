import { EditorView } from "@codemirror/view"
import { CaretDown, CaretRight, Paragraph, TextAa } from "@phosphor-icons/react"
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror"
import { useEffect, useMemo, useRef } from "react"
import { MiddlePath } from "../ui/MiddlePath"
import { usePersistentState } from "../ui/usePersistentState"
import { isBinaryPatch } from "./binaryPatch"
import { classifyDiffLine, diffHighlighter } from "./diffHighlight"
import { diffLineNumbers } from "./diffLineNumbers"
import { splitPatchHeader } from "./patchHeader"
import "./DiffView.css"

// Theme built entirely from CSS custom properties, so it follows the app's
// light/dark setting automatically. `theme="none"` on the editor prevents
// CodeMirror's default light theme from overriding these.
const diffTheme = EditorView.theme({
	"&": {
		height: "100%",
		backgroundColor: "var(--surface)",
		color: "var(--fg)",
		fontSize: "12.5px",
	},
	"&.cm-focused": { outline: "none" },
	".cm-scroller": {
		fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
		lineHeight: "1.55",
		overflow: "auto",
	},
	// Force a visible classic scrollbar (macOS overlay scrollbars otherwise
	// stay hidden even when the diff overflows).
	".cm-scroller::-webkit-scrollbar": { width: "14px", height: "14px" },
	".cm-scroller::-webkit-scrollbar-thumb": {
		backgroundColor: "var(--scrollbar)",
		borderRadius: "7px",
		border: "3px solid transparent",
		backgroundClip: "padding-box",
	},
	".cm-scroller::-webkit-scrollbar-track": { backgroundColor: "transparent" },
	".cm-content": { caretColor: "var(--fg)" },
	".cm-line": { padding: "0 12px" },
	// Explicit backgrounds on every structural element so nothing falls back to
	// CodeMirror's default (white) under theme="none" — was causing a stray
	// white rectangle over the first gutter cells.
	".cm-gutters": {
		backgroundColor: "var(--surface)",
		borderRight: "1px solid var(--border)",
		color: "var(--muted)",
	},
	".cm-gutter": { backgroundColor: "var(--surface)" },
	".cm-gutterElement": {
		backgroundColor: "transparent",
		color: "var(--muted)",
	},
	".cm-activeLineGutter": { backgroundColor: "transparent" },
	".cm-activeLine": { backgroundColor: "transparent" },
	".cm-cursor, .cm-dropCursor": { display: "none" },
	".cm-selectionLayer .cm-selectionBackground, & .cm-selectionBackground": {
		backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)",
	},
	".cm-diff-lineno .cm-gutterElement": {
		padding: "0 6px",
		minWidth: "2.5ch",
		textAlign: "right",
		fontVariantNumeric: "tabular-nums",
	},
})

function countStats(diff: string): { add: number; del: number } {
	let add = 0
	let del = 0
	for (const line of diff.split("\n")) {
		const kind = classifyDiffLine(line)
		if (kind === "add") {
			add++
		} else if (kind === "del") {
			del++
		}
	}
	return { add, del }
}

export function DiffView({
	diff,
	path,
	ignoreWhitespace,
	onToggleIgnoreWhitespace,
	onShowAsText,
	rootRef,
	onRetreat,
}: {
	diff: string
	path?: string | null
	ignoreWhitespace: boolean
	onToggleIgnoreWhitespace: () => void
	// Re-reads the open file with `--text`. Absent when already forced.
	onShowAsText?: () => void
	rootRef?: React.RefObject<HTMLDivElement | null>
	onRetreat?: () => void
}) {
	const stats = useMemo(() => countStats(diff), [diff])
	const hasDiff = diff.trim() !== ""
	// Git's "Binary files … differ" placeholder isn't a diff; rendering it in the
	// editor looked like a broken diff. Show what happened, and offer the escape
	// hatch — most such files are source with a stray NUL in a string literal.
	const isBinary = useMemo(() => isBinaryPatch(diff), [diff])
	// The git preamble is folded away by default: the path and +/− counts it
	// restates are already in the header above, so it's noise in front of the
	// changes. Kept reachable — it carries the blob hashes and file mode.
	const { header, body } = useMemo(() => splitPatchHeader(diff), [diff])
	const [headerOpen, setHeaderOpen] = usePersistentState(
		"diff-header-open",
		false,
	)
	const cmRef = useRef<ReactCodeMirrorRef>(null)

	// Reset scroll to the top whenever a different file/diff is shown.
	useEffect(() => {
		cmRef.current?.view?.scrollDOM.scrollTo({ top: 0, left: 0 })
	}, [diff, path])

	// Cross-panel keys only apply when THIS container is the focused element
	// (reached via the Enter/Backspace focus chain). If the key originated
	// inside the CodeMirror editor (the user clicked into the diff text), let
	// CM handle it — otherwise Arrow keys would scroll twice and Backspace
	// would reach the editor. The editor is `readOnly`, so Backspace can't
	// edit; here Backspace is repurposed to return focus to the file list,
	// and Arrow keys scroll the diff.
	function onKeyDown(e: React.KeyboardEvent) {
		if (cmRef.current?.view?.contentDOM.contains(e.target as Node)) {
			return
		}
		if (e.key === "Backspace") {
			e.preventDefault()
			onRetreat?.()
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault()
			cmRef.current?.view?.scrollDOM.scrollBy({
				top: e.key === "ArrowDown" ? 60 : -60,
			})
		}
	}

	return (
		<div className="diff-view" ref={rootRef} tabIndex={0} onKeyDown={onKeyDown}>
			<div className="diff-header">
				{path ? (
					<>
						<MiddlePath path={path} className="diff-header-path" />
						<span className="diff-header-stats">
							<span className="diff-stat-add">+{stats.add}</span>
							<span className="diff-stat-del">−{stats.del}</span>
						</span>
					</>
				) : (
					<span className="diff-header-path diff-header-path--empty" />
				)}
				<button
					type="button"
					className={`diff-ws-toggle ${ignoreWhitespace ? "is-on" : ""}`}
					title="Ignore whitespace changes (-w)"
					aria-pressed={ignoreWhitespace}
					onClick={onToggleIgnoreWhitespace}
				>
					<Paragraph />
					Ignore whitespace
				</button>
			</div>
			{header !== "" && !isBinary && (
				<div className="diff-meta">
					<button
						type="button"
						className="diff-meta-toggle"
						aria-expanded={headerOpen}
						onClick={() => setHeaderOpen((open) => !open)}
					>
						{headerOpen ? <CaretDown /> : <CaretRight />}
						diff header
					</button>
					{headerOpen && <pre className="diff-meta-body">{header}</pre>}
				</div>
			)}
			<div className="diff-body">
				{isBinary ? (
					<div className="diff-empty">
						<span>Git treats this file as binary, so it has no text diff.</span>
						{onShowAsText && (
							<button
								type="button"
								className="diff-show-text"
								onClick={onShowAsText}
							>
								<TextAa />
								Show as text
							</button>
						)}
						<span className="diff-empty-hint">
							A single NUL byte anywhere in the first 8000 is enough for git to
							call a file binary.
						</span>
					</div>
				) : hasDiff ? (
					<CodeMirror
						ref={cmRef}
						className="diff-cm"
						height="100%"
						value={body}
						editable={false}
						readOnly={true}
						theme="none"
						basicSetup={{
							lineNumbers: false,
							foldGutter: false,
							highlightActiveLine: false,
						}}
						extensions={[
							EditorView.lineWrapping,
							diffLineNumbers,
							diffHighlighter,
							diffTheme,
						]}
					/>
				) : (
					<div className="diff-empty">
						{path
							? "No textual changes to display"
							: "Select a file to view its diff"}
					</div>
				)}
			</div>
		</div>
	)
}
