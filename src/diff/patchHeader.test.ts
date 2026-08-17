import { describe, expect, it } from "vitest"
import { splitPatchHeader } from "./patchHeader"

const PREAMBLE = [
	"diff --git a/src/main.rs b/src/main.rs",
	"index 1a2b3c4..5d6e7f8 100644",
	"--- a/src/main.rs",
	"+++ b/src/main.rs",
]
const HUNK = ["@@ -1,3 +1,4 @@", " fn main() {", "+    println!();", " }"]

describe("splitPatchHeader", () => {
	it("splits at the first hunk", () => {
		const { header, body } = splitPatchHeader([...PREAMBLE, ...HUNK].join("\n"))

		expect(header).toBe(PREAMBLE.join("\n"))
		expect(body).toBe(HUNK.join("\n"))
	})

	// The body has to start AT the hunk marker: the gutter reads line numbers from
	// it, so dropping it would renumber the whole diff.
	it("keeps the hunk marker in the body", () => {
		const { body } = splitPatchHeader([...PREAMBLE, ...HUNK].join("\n"))

		expect(body.startsWith("@@ -1,3 +1,4 @@")).toBe(true)
	})

	it("keeps every hunk, not just the first", () => {
		const second = ["@@ -20,2 +21,3 @@", " x", "+y"]
		const { body } = splitPatchHeader(
			[...PREAMBLE, ...HUNK, ...second].join("\n"),
		)

		expect(body).toContain("@@ -20,2 +21,3 @@")
		expect(body).toContain("+y")
	})

	// A rename with no content change has no hunk, and its preamble IS the
	// information — folding it away would leave an empty panel.
	it("does not fold a patch that has no hunks", () => {
		const renameOnly = [
			"diff --git a/old.ts b/new.ts",
			"similarity index 100%",
			"rename from old.ts",
			"rename to new.ts",
		].join("\n")

		const { header, body } = splitPatchHeader(renameOnly)

		expect(header).toBe("")
		expect(body).toBe(renameOnly)
	})

	it("handles a patch that already starts at a hunk", () => {
		const { header, body } = splitPatchHeader(HUNK.join("\n"))

		expect(header).toBe("")
		expect(body).toBe(HUNK.join("\n"))
	})

	it("handles an empty patch", () => {
		expect(splitPatchHeader("")).toEqual({ header: "", body: "" })
	})

	// A line inside the diff content could begin with "@@" only if it were a
	// removed/added line, which starts with -/+ first — so the first bare "@@" is
	// always the real marker.
	it("is not confused by @@ appearing inside a changed line", () => {
		const withAt = [
			...PREAMBLE,
			"@@ -1,2 +1,2 @@",
			"-const a = '@@ not a hunk'",
			"+const a = 'x'",
		].join("\n")

		const { header } = splitPatchHeader(withAt)

		expect(header).toBe(PREAMBLE.join("\n"))
	})
})
