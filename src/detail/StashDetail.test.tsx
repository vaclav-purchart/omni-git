import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { stashFiles, stashFileDiff } = vi.hoisted(() => ({
	stashFiles: vi.fn(),
	stashFileDiff: vi.fn(),
}))

vi.mock("../ipc/bindings", () => ({
	commands: { stashFiles, stashFileDiff },
}))

import { StashDetail } from "./StashDetail"

const STASH = { selector: "stash@{0}", message: "WIP on main: retry logic" }

beforeEach(() => {
	// mockResolvedValue does NOT reset call history, and these mocks are module
	// scoped — the counts below would otherwise carry over from earlier tests.
	stashFiles.mockClear()
	stashFileDiff.mockClear()
	stashFiles.mockResolvedValue({
		status: "ok",
		data: [
			{ status: "M", path: "a.txt" },
			{ status: "A", path: "u.txt" },
		],
	})
	stashFileDiff.mockResolvedValue({ status: "ok", data: "@@ -1 +1 @@" })
})

function renderDetail(
	props: Partial<React.ComponentProps<typeof StashDetail>> = {},
) {
	const onFileDiff = vi.fn()
	render(
		<StashDetail
			repoPath="/repo"
			stash={STASH}
			onFileDiff={onFileDiff}
			ignoreWhitespace={false}
			{...props}
		/>,
	)
	return { onFileDiff }
}

describe("StashDetail", () => {
	it("lists the stash's files", async () => {
		renderDetail()

		expect(await screen.findByText("a.txt")).toBeInTheDocument()
		// Untracked-when-stashed files are part of the stash and must be listed.
		expect(screen.getByText("u.txt")).toBeInTheDocument()
		expect(stashFiles).toHaveBeenCalledWith("/repo", "stash@{0}")
	})

	it("names the stash", async () => {
		renderDetail()

		expect(await screen.findByText(/retry logic/)).toBeInTheDocument()
		expect(screen.getByText("stash@{0}")).toBeInTheDocument()
	})

	it("loads a file's patch on click", async () => {
		const { onFileDiff } = renderDetail()

		await userEvent.click(await screen.findByText("a.txt"))

		expect(stashFileDiff).toHaveBeenCalledWith(
			"/repo",
			"stash@{0}",
			"a.txt",
			false,
			false,
		)
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenCalledWith("@@ -1 +1 @@", "a.txt"),
		)
	})

	it("re-reads the open file when the whitespace mode flips", async () => {
		const { rerender } = render(
			<StashDetail
				repoPath="/repo"
				stash={STASH}
				onFileDiff={vi.fn()}
				ignoreWhitespace={false}
			/>,
		)
		await userEvent.click(await screen.findByText("a.txt"))
		stashFileDiff.mockClear()

		rerender(
			<StashDetail
				repoPath="/repo"
				stash={STASH}
				onFileDiff={vi.fn()}
				ignoreWhitespace={true}
			/>,
		)

		await waitFor(() =>
			expect(stashFileDiff).toHaveBeenCalledWith(
				"/repo",
				"stash@{0}",
				"a.txt",
				true,
				false,
			),
		)
	})

	// Apply keeps the stash, pop drops it — the difference that matters, so they
	// are two buttons rather than one with a mode.
	it("offers apply and pop separately", async () => {
		const onApply = vi.fn()
		const onPop = vi.fn()
		renderDetail({ onApply, onPop })
		await screen.findByText("a.txt")

		await userEvent.click(screen.getByRole("button", { name: "Apply" }))
		expect(onApply).toHaveBeenCalledWith(STASH)

		await userEvent.click(screen.getByRole("button", { name: "Pop" }))
		expect(onPop).toHaveBeenCalledWith(STASH)
	})

	it("says what to do when no stash is selected", () => {
		renderDetail({ stash: null })

		expect(screen.getByText(/Select a stash/)).toBeInTheDocument()
		expect(stashFiles).not.toHaveBeenCalled()
	})

	// A reload replaces the stash objects; keying on the object rather than the
	// selector would blank the panel after every mutation.
	it("does not reload for an equal stash with a new identity", async () => {
		const { rerender } = render(
			<StashDetail
				repoPath="/repo"
				stash={{ ...STASH }}
				onFileDiff={vi.fn()}
				ignoreWhitespace={false}
			/>,
		)
		await screen.findByText("a.txt")
		expect(stashFiles).toHaveBeenCalledTimes(1)

		rerender(
			<StashDetail
				repoPath="/repo"
				stash={{ ...STASH }}
				onFileDiff={vi.fn()}
				ignoreWhitespace={false}
			/>,
		)

		expect(stashFiles).toHaveBeenCalledTimes(1)
	})
})
