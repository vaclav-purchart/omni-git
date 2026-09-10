import { Fragment, useMemo } from "react"
import { type AnsiSpan, parseAnsi } from "./ansi"

function classesFor(span: AnsiSpan): string | undefined {
	const classes: string[] = []
	if (span.fg !== undefined) {
		classes.push(`ansi-fg-${span.fg}`)
	}
	if (span.bg !== undefined) {
		classes.push(`ansi-bg-${span.bg}`)
	}
	if (span.bold) {
		classes.push("ansi-bold")
	}
	if (span.dim) {
		classes.push("ansi-dim")
	}
	if (span.italic) {
		classes.push("ansi-italic")
	}
	if (span.underline) {
		classes.push("ansi-underline")
	}
	return classes.length === 0 ? undefined : classes.join(" ")
}

/**
 * Terminal output with its ANSI colours rendered as styled spans and every
 * other escape sequence removed. Unstyled runs are emitted as bare text so the
 * common case — plain output — adds no elements.
 *
 * Re-parses the whole string when it changes. Output streams in and grows, so
 * this is O(total) per chunk, but hook output is tens of kilobytes at most and
 * the parse is a single pass; simpler than carrying parser state across
 * renders.
 */
export function AnsiText({ text }: { text: string }) {
	const spans = useMemo(() => parseAnsi(text), [text])
	return (
		<>
			{spans.map((span, i) => {
				const className = classesFor(span)
				return className === undefined ? (
					<Fragment key={i}>{span.text}</Fragment>
				) : (
					<span key={i} className={className}>
						{span.text}
					</span>
				)
			})}
		</>
	)
}
