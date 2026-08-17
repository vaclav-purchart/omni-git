import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { __resetSettingsForTests as resetSettings } from "../settings/settings"
import { DiffView } from "./DiffView"

describe("DiffView", () => {
	it("renders diff text and a file-path header", async () => {
		const diff = "@@ -1 +1 @@\n-old line\n+new line\n"
		render(
			<DiffView
				diff={diff}
				path="src/foo/bar.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={() => {}}
			/>,
		)
		expect(await screen.findByText(/new line/)).toBeInTheDocument()
		// MiddlePath keeps the filename fully visible in the header.
		expect(screen.getByText("bar.ts")).toBeInTheDocument()
	})

	it("shows a select-a-file empty state when no file is chosen", () => {
		render(
			<DiffView
				diff=""
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={() => {}}
			/>,
		)
		expect(screen.getByText(/select a file/i)).toBeInTheDocument()
	})

	it("shows a no-changes state when a chosen file has an empty diff", () => {
		render(
			<DiffView
				diff=""
				path="src/foo/bar.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={() => {}}
			/>,
		)
		expect(screen.getByText(/no textual changes/i)).toBeInTheDocument()
	})

	it("calls onRetreat on Backspace dispatched from the container", () => {
		const onRetreat = vi.fn()
		const diff = "@@ -1 +1 @@\n-old line\n+new line\n"
		const { container } = render(
			<DiffView
				diff={diff}
				path="src/foo/bar.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={() => {}}
				onRetreat={onRetreat}
			/>,
		)
		const root = container.querySelector(".diff-view")
		expect(root).not.toBeNull()
		fireEvent.keyDown(root as Element, { key: "Backspace" })
		expect(onRetreat).toHaveBeenCalledTimes(1)
	})
})

describe("DiffView binary files", () => {
	const BINARY =
		"diff --git a/f.ts b/f.ts\nnew file mode 100644\nindex 0000..cd51\nBinary files /dev/null and b/f.ts differ"

	// Previously this placeholder was fed straight to the editor, so the user saw
	// a lone "Binary files … differ" line rendered as though it were the diff.
	it("explains instead of rendering git's placeholder as a diff", () => {
		render(
			<DiffView
				diff={BINARY}
				path="f.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={vi.fn()}
				onShowAsText={vi.fn()}
			/>,
		)

		expect(screen.getByText(/treats this file as binary/)).toBeInTheDocument()
		expect(screen.queryByText(/Binary files/)).not.toBeInTheDocument()
	})

	// Most such files are source with a stray NUL, so the text diff is what the
	// user actually wants.
	it("offers Show as text and reports the request", () => {
		const onShowAsText = vi.fn()
		render(
			<DiffView
				diff={BINARY}
				path="f.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={vi.fn()}
				onShowAsText={onShowAsText}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Show as text/ }))

		expect(onShowAsText).toHaveBeenCalled()
	})

	// Omitted once already forced, so there's nothing to press twice.
	it("hides Show as text when no handler is given", () => {
		render(
			<DiffView
				diff={BINARY}
				path="f.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={vi.fn()}
			/>,
		)

		expect(
			screen.queryByRole("button", { name: /Show as text/ }),
		).not.toBeInTheDocument()
		expect(screen.getByText(/treats this file as binary/)).toBeInTheDocument()
	})

	it("renders an ordinary diff normally", () => {
		render(
			<DiffView
				diff={"@@ -1 +1,2 @@\n const a = 1\n+const b = 2"}
				path="f.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={vi.fn()}
				onShowAsText={vi.fn()}
			/>,
		)

		expect(
			screen.queryByText(/treats this file as binary/),
		).not.toBeInTheDocument()
	})
})

describe("DiffView patch header", () => {
	const PATCH = [
		"diff --git a/f.ts b/f.ts",
		"index 1a2b3c4..5d6e7f8 100644",
		"--- a/f.ts",
		"+++ b/f.ts",
		"@@ -1,2 +1,3 @@",
		" const a = 1",
		"+const b = 2",
	].join("\n")

	function renderPatch(diff = PATCH) {
		return render(
			<DiffView
				diff={diff}
				path="f.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={vi.fn()}
			/>,
		)
	}

	beforeEach(() => {
		resetSettings()
	})

	// The path and +/- counts it restates are already in the view's own header.
	it("folds the git preamble away by default", () => {
		renderPatch()

		expect(screen.queryByText(/diff --git/)).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: /diff header/ })).toHaveAttribute(
			"aria-expanded",
			"false",
		)
	})

	it("shows it when expanded", async () => {
		renderPatch()

		await userEvent.click(screen.getByRole("button", { name: /diff header/ }))

		expect(screen.getByText(/diff --git a\/f.ts/)).toBeInTheDocument()
	})

	// Nothing to fold, so no control to click.
	it("offers no toggle when the patch has no preamble", () => {
		renderPatch("@@ -1 +1,2 @@\n a\n+b")

		expect(
			screen.queryByRole("button", { name: /diff header/ }),
		).not.toBeInTheDocument()
	})

	// A rename-only patch is ALL preamble; folding it would leave an empty panel.
	it("offers no toggle for a patch with no hunks", () => {
		renderPatch("diff --git a/old.ts b/new.ts\nrename from old.ts")

		expect(
			screen.queryByRole("button", { name: /diff header/ }),
		).not.toBeInTheDocument()
	})
})
