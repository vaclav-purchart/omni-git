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

// Finding text within the open diff: ⌘F or the header's magnifier, matches
// highlighted and scrolled to, with a count and prev/next.
describe("DiffView search", () => {
	const DIFF = [
		"@@ -1,4 +1,4 @@",
		" const foo = 1",
		"-let food = foo",
		"+let food = foo + 1",
		" // FOO",
	].join("\n")

	function renderDiff() {
		return render(
			<DiffView
				diff={DIFF}
				path="src/a.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={() => {}}
			/>,
		)
	}

	it("has no search bar until asked for one", () => {
		renderDiff()

		expect(screen.queryByLabelText("Search the diff")).not.toBeInTheDocument()
		expect(screen.getByLabelText("Find in diff")).toBeInTheDocument()
	})

	it("opens the bar from the header button", async () => {
		renderDiff()

		await userEvent.setup().click(screen.getByLabelText("Find in diff"))

		expect(screen.getByLabelText("Search the diff")).toHaveFocus()
	})

	it("opens the bar on Cmd/Ctrl+F", async () => {
		const { container } = renderDiff()
		const root = container.querySelector(".diff-view") as Element

		fireEvent.keyDown(root, { key: "f", code: "KeyF", metaKey: true })

		expect(await screen.findByLabelText("Search the diff")).toHaveFocus()
	})

	// Case-insensitive, so `foo` finds `foo`, `food` twice over and `FOO`.
	it("counts the matches as they are typed", async () => {
		renderDiff()
		const user = userEvent.setup()
		await user.click(screen.getByLabelText("Find in diff"))

		await user.type(screen.getByLabelText("Search the diff"), "foo")

		expect(await screen.findByText(/of 6$/)).toBeInTheDocument()
	})

	it("reports a query that matches nothing", async () => {
		renderDiff()
		const user = userEvent.setup()
		await user.click(screen.getByLabelText("Find in diff"))

		await user.type(screen.getByLabelText("Search the diff"), "zzz")

		expect(await screen.findByText("no matches")).toBeInTheDocument()
	})

	it("steps to the next match, wrapping at the end", async () => {
		renderDiff()
		const user = userEvent.setup()
		await user.click(screen.getByLabelText("Find in diff"))
		await user.type(screen.getByLabelText("Search the diff"), "food")
		expect(await screen.findByText("1 of 2")).toBeInTheDocument()

		await user.click(screen.getByLabelText("Next match"))
		expect(await screen.findByText("2 of 2")).toBeInTheDocument()

		await user.click(screen.getByLabelText("Next match"))
		expect(await screen.findByText("1 of 2")).toBeInTheDocument()
	})

	it("steps backward, wrapping at the start", async () => {
		renderDiff()
		const user = userEvent.setup()
		await user.click(screen.getByLabelText("Find in diff"))
		await user.type(screen.getByLabelText("Search the diff"), "food")

		await user.click(screen.getByLabelText("Previous match"))

		expect(await screen.findByText("2 of 2")).toBeInTheDocument()
	})

	it("closes the bar and drops the query", async () => {
		renderDiff()
		const user = userEvent.setup()
		await user.click(screen.getByLabelText("Find in diff"))
		await user.type(screen.getByLabelText("Search the diff"), "foo")

		await user.click(screen.getByLabelText("Close search"))

		expect(screen.queryByLabelText("Search the diff")).not.toBeInTheDocument()
		// Re-opening starts clean rather than restoring the old query.
		await user.click(screen.getByLabelText("Find in diff"))
		expect(screen.getByLabelText("Search the diff")).toHaveValue("")
	})

	// Backspace normally leaves the diff; while searching it must edit the query.
	it("does not retreat on Backspace while searching", async () => {
		const onRetreat = vi.fn()
		render(
			<DiffView
				diff={DIFF}
				path="src/a.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={() => {}}
				onRetreat={onRetreat}
			/>,
		)
		const user = userEvent.setup()
		await user.click(screen.getByLabelText("Find in diff"))

		await user.type(screen.getByLabelText("Search the diff"), "a{backspace}")

		expect(onRetreat).not.toHaveBeenCalled()
	})

	// Nothing to search in, so the affordance would be a dead control.
	it("offers no search button without a diff", () => {
		render(
			<DiffView
				diff=""
				path="src/a.ts"
				ignoreWhitespace={false}
				onToggleIgnoreWhitespace={() => {}}
			/>,
		)

		expect(screen.queryByLabelText("Find in diff")).not.toBeInTheDocument()
	})
})
