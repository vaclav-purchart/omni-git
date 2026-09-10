import { describe, expect, it } from "vitest"
import { parseAnsi } from "./ansi"

const ESC = "\u001b"
const BEL = "\u0007"

describe("parseAnsi", () => {
	it("passes plain text through as one span", () => {
		expect(parseAnsi("hello\nworld")).toEqual([{ text: "hello\nworld" }])
	})

	it("returns nothing for empty input", () => {
		expect(parseAnsi("")).toEqual([])
	})

	// The vitest reporter's "FAIL" badge: bold + red, then reset.
	it("splits text at SGR colour changes", () => {
		expect(parseAnsi(`${ESC}[1m${ESC}[31mFAIL${ESC}[0m ok`)).toEqual([
			{ text: "FAIL", bold: true, fg: "red" },
			{ text: " ok" },
		])
	})

	it("understands combined SGR parameters", () => {
		expect(parseAnsi(`${ESC}[1;31mx${ESC}[m`)).toEqual([
			{ text: "x", bold: true, fg: "red" },
		])
	})

	it("knows the bright colours and backgrounds", () => {
		expect(parseAnsi(`${ESC}[90m${ESC}[41mx`)).toEqual([
			{ text: "x", fg: "bright-black", bg: "red" },
		])
	})

	// vitest's "───────" rule: colour set with 31, cleared with 39, but the
	// following text is still bold if 22 wasn't sent.
	it("clears one attribute at a time", () => {
		expect(
			parseAnsi(
				`${ESC}[1m${ESC}[31ma${ESC}[39mb${ESC}[22mc${ESC}[2md${ESC}[22me`,
			),
		).toEqual([
			{ text: "a", bold: true, fg: "red" },
			{ text: "b", bold: true },
			{ text: "c" },
			{ text: "d", dim: true },
			{ text: "e" },
		])
	})

	it("handles underline and italic", () => {
		expect(parseAnsi(`${ESC}[4m${ESC}[3mx${ESC}[24m${ESC}[23my`)).toEqual([
			{ text: "x", underline: true, italic: true },
			{ text: "y" },
		])
	})

	// 256-colour and truecolour SGR: not rendered, but must not leak into the
	// text or desynchronise the parser.
	it("skips extended colours without breaking", () => {
		expect(parseAnsi(`${ESC}[38;5;208mx${ESC}[38;2;1;2;3my${ESC}[0mz`)).toEqual(
			[{ text: "xyz" }],
		)
	})

	// lint-staged's spinner hides and shows the cursor. Other CSI sequences
	// (cursor moves, erase line) are just as meaningless in a static panel.
	it("drops non-SGR control sequences", () => {
		expect(parseAnsi(`${ESC}[?25la${ESC}[?25h${ESC}[2K${ESC}[1Gb`)).toEqual([
			{ text: "ab" },
		])
	})

	// OSC 8 hyperlinks and window titles: ESC ] … BEL, or ESC ] … ESC \.
	it("drops operating-system commands", () => {
		expect(
			parseAnsi(
				`${ESC}]8;;https://x${BEL}link${ESC}]8;;${ESC}\\ ${ESC}]0;title${BEL}t`,
			),
		).toEqual([{ text: "link t" }])
	})

	// Output arrives in chunks and is re-parsed each time; a sequence cut at the
	// chunk boundary must not show its head as text. Dropping it is right: the
	// completed sequence is parsed on the next chunk.
	it("drops a sequence cut off by the end of the input", () => {
		expect(parseAnsi(`ab${ESC}[3`)).toEqual([{ text: "ab" }])
		expect(parseAnsi(`ab${ESC}`)).toEqual([{ text: "ab" }])
	})

	it("emits no empty spans", () => {
		expect(parseAnsi(`${ESC}[31m${ESC}[0m${ESC}[1m`)).toEqual([])
	})
})
