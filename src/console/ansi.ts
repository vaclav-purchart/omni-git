/**
 * Turns terminal output into styled runs of text.
 *
 * Hooks write for a terminal: vitest colours its FAIL badges, lint-staged
 * hides the cursor around a spinner, chalk resets after every word. Shown
 * raw, every ESC byte became a box glyph and the `[31m` after it noise — the
 * output was there but unreadable. This keeps the colours a terminal would
 * have shown and drops everything a static panel can't act on.
 *
 * Only the 16 named colours and the basic attributes are kept: that is what
 * the tools hooks run actually use, and a fixed palette can be themed in CSS.
 * 256-colour and truecolour parameters are consumed but not rendered, so a
 * tool that uses them degrades to the default colour rather than to garbage.
 */

export type AnsiColor =
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "bright-black"
	| "bright-red"
	| "bright-green"
	| "bright-yellow"
	| "bright-blue"
	| "bright-magenta"
	| "bright-cyan"
	| "bright-white"

export type AnsiSpan = {
	text: string
	fg?: AnsiColor
	bg?: AnsiColor
	bold?: true
	dim?: true
	italic?: true
	underline?: true
}

type Style = Omit<AnsiSpan, "text">

const ESC = "\u001b"
const BEL = "\u0007"

const COLORS: readonly AnsiColor[] = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
]

const BRIGHT: readonly AnsiColor[] = [
	"bright-black",
	"bright-red",
	"bright-green",
	"bright-yellow",
	"bright-blue",
	"bright-magenta",
	"bright-cyan",
	"bright-white",
]

/**
 * Applies one SGR parameter list (the `1;31` of `ESC[1;31m`) to `style`.
 * Returns a fresh object; `style` is not mutated.
 */
function applySgr(style: Style, params: string): Style {
	const next: Style = { ...style }
	// `ESC[m` is shorthand for `ESC[0m`.
	const codes = (params === "" ? "0" : params).split(";").map(Number)
	for (let i = 0; i < codes.length; i++) {
		const code = codes[i]
		if (Number.isNaN(code)) {
			continue
		}
		if (code === 0) {
			return {}
		}
		if (code === 1) {
			next.bold = true
		} else if (code === 2) {
			next.dim = true
		} else if (code === 3) {
			next.italic = true
		} else if (code === 4) {
			next.underline = true
		} else if (code === 22) {
			delete next.bold
			delete next.dim
		} else if (code === 23) {
			delete next.italic
		} else if (code === 24) {
			delete next.underline
		} else if (code >= 30 && code <= 37) {
			next.fg = COLORS[code - 30]
		} else if (code === 39) {
			delete next.fg
		} else if (code >= 40 && code <= 47) {
			next.bg = COLORS[code - 40]
		} else if (code === 49) {
			delete next.bg
		} else if (code >= 90 && code <= 97) {
			next.fg = BRIGHT[code - 90]
		} else if (code >= 100 && code <= 107) {
			next.bg = BRIGHT[code - 100]
		} else if (code === 38 || code === 48) {
			// Extended colour: `38;5;n` or `38;2;r;g;b`. Not rendered, but the
			// parameters must be skipped or `5`/`2` would be read as attributes.
			const mode = codes[i + 1]
			i += mode === 2 ? 4 : mode === 5 ? 2 : 0
			if (code === 38) {
				delete next.fg
			} else {
				delete next.bg
			}
		}
	}
	return next
}

/**
 * Index just past the control sequence starting at `text[start]` (an ESC),
 * plus the SGR parameters when it was one. `end` is `-1` when the sequence is
 * cut off by the end of the input: output streams in chunks and is re-parsed
 * whole each time, so an unfinished sequence is simply not shown yet.
 */
function readSequence(
	text: string,
	start: number,
): { end: number; sgr?: string } {
	const kind = text[start + 1]
	if (kind === undefined) {
		return { end: -1 }
	}
	if (kind === "[") {
		// CSI: parameter and intermediate bytes 0x20–0x3F, then one final byte
		// 0x40–0x7E. Only `m` (SGR) carries anything a static panel can show.
		let i = start + 2
		while (i < text.length) {
			const c = text.charCodeAt(i)
			if (c >= 0x40 && c <= 0x7e) {
				return {
					end: i + 1,
					sgr: text[i] === "m" ? text.slice(start + 2, i) : undefined,
				}
			}
			if (c < 0x20 || c > 0x3f) {
				// Malformed: bail out of the sequence, keep the rest as text.
				return { end: i }
			}
			i++
		}
		return { end: -1 }
	}
	if (kind === "]") {
		// OSC: ends at BEL or ST (ESC \). Hyperlinks, window titles.
		for (let i = start + 2; i < text.length; i++) {
			if (text[i] === BEL) {
				return { end: i + 1 }
			}
			if (text[i] === ESC) {
				return text[i + 1] === "\\"
					? { end: i + 2 }
					: text[i + 1] === undefined
						? { end: -1 }
						: { end: i }
			}
		}
		return { end: -1 }
	}
	// Two-byte sequence (ESC 7, ESC = …): nothing to show.
	return { end: start + 2 }
}

const STYLE_KEYS = ["fg", "bg", "bold", "dim", "italic", "underline"] as const

function sameStyle(a: Style, b: Style): boolean {
	return STYLE_KEYS.every((k) => a[k] === b[k])
}

/** Splits `text` into runs of uniformly styled text, escape codes removed. */
export function parseAnsi(text: string): AnsiSpan[] {
	const spans: AnsiSpan[] = []
	let style: Style = {}
	let buf = ""
	const flush = () => {
		if (buf !== "") {
			spans.push({ text: buf, ...style })
			buf = ""
		}
	}
	let i = 0
	while (i < text.length) {
		const esc = text.indexOf(ESC, i)
		if (esc === -1) {
			buf += text.slice(i)
			break
		}
		buf += text.slice(i, esc)
		const { end, sgr } = readSequence(text, esc)
		if (end === -1) {
			break
		}
		if (sgr !== undefined) {
			const next = applySgr(style, sgr)
			// Only start a new span when the style actually changed: a colour
			// set and cleared with nothing between, or an extended colour that
			// isn't rendered, must not split a plain run into pieces.
			if (!sameStyle(style, next)) {
				flush()
				style = next
			}
		}
		i = end
	}
	flush()
	return spans
}
