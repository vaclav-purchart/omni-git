import { describe, expect, it } from "vitest"
import { asWorkingSection } from "./workingSection"

describe("asWorkingSection", () => {
	it("accepts every section the backend knows", () => {
		expect(asWorkingSection("Staged")).toBe("Staged")
		expect(asWorkingSection("Unstaged")).toBe("Unstaged")
		expect(asWorkingSection("Untracked")).toBe("Untracked")
		expect(asWorkingSection("Conflicted")).toBe("Conflicted")
	})

	// THE bug this replaces: the call site cast a FileList key straight to
	// WorkingSection, so "Conflicted" — which the backend had no variant for —
	// reached it as a lie and the diff came back as nothing at all.
	it("rejects a key the backend has no variant for", () => {
		expect(asWorkingSection("Conflicting")).toBeNull()
		expect(asWorkingSection("changed")).toBeNull()
		expect(asWorkingSection("")).toBeNull()
	})
})
