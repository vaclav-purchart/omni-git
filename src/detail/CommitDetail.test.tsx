import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CommitSummary } from "../ipc/bindings"
import { __resetSettingsForTests as resetSettings } from "../settings/settings"
import { CommitDetail } from "./CommitDetail"

const { commitFiles, fileDiff, commitMessage } = vi.hoisted(() => ({
	commitFiles: vi.fn(),
	fileDiff: vi.fn(),
	commitMessage: vi.fn(),
}))

vi.mock("../ipc/bindings", () => ({
	commands: {
		commitFiles,
		fileDiff,
		commitMessage,
	},
}))

beforeEach(() => {
	resetSettings()
	commitMessage.mockResolvedValue({ status: "ok", data: "a commit message" })
})

function makeCommit(hash: string): CommitSummary {
	return {
		hash,
		parents: [],
		author_name: "Test",
		author_email: "test@example.com",
		timestamp_ms: 0,
		refs: [],
		subject: `subject ${hash}`,
	}
}

describe("CommitDetail effect stability", () => {
	it("loads files once and does not reload when only the onFileDiff identity changes", async () => {
		commitFiles.mockResolvedValue({
			status: "ok",
			data: [{ status: "M", path: "a.txt" }],
		})
		fileDiff.mockResolvedValue({ status: "ok", data: "" })
		const commit = makeCommit("c1")

		const { rerender } = render(
			<CommitDetail
				repoPath="/repo"
				selectedCommit={commit}
				onFileDiff={() => {}}
				ignoreWhitespace={false}
			/>,
		)
		// Files render (the loop bug discarded every response, so they never did).
		expect(await screen.findByText("a.txt")).toBeInTheDocument()

		// Re-render with a BRAND-NEW onFileDiff identity, same commit — this is
		// what an inline parent callback does every render. Must NOT reload.
		rerender(
			<CommitDetail
				repoPath="/repo"
				selectedCommit={commit}
				onFileDiff={() => {}}
				ignoreWhitespace={false}
			/>,
		)
		rerender(
			<CommitDetail
				repoPath="/repo"
				selectedCommit={commit}
				onFileDiff={() => {}}
				ignoreWhitespace={false}
			/>,
		)
		await Promise.resolve()

		expect(commitFiles).toHaveBeenCalledTimes(1)
	})
})

describe("CommitDetail keyboard navigation", () => {
	it("moves through files with arrow keys and loads each diff", async () => {
		commitFiles.mockResolvedValue({
			status: "ok",
			data: [
				{ status: "M", path: "a.txt" },
				{ status: "A", path: "b.txt" },
			],
		})
		fileDiff.mockImplementation((_r: string, _h: string, path: string) =>
			Promise.resolve({ status: "ok", data: `diff:${path}` }),
		)
		const onFileDiff = vi.fn()
		render(
			<CommitDetail
				repoPath="/repo"
				selectedCommit={makeCommit("c1")}
				onFileDiff={onFileDiff}
				ignoreWhitespace={false}
			/>,
		)
		await screen.findByText("a.txt")
		const list = screen.getByRole("listbox", { name: "Changed files" })

		// First ArrowDown (nothing selected) → first file.
		fireEvent.keyDown(list, { key: "ArrowDown" })
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenLastCalledWith("diff:a.txt", "a.txt"),
		)

		// Next ArrowDown → second file.
		fireEvent.keyDown(list, { key: "ArrowDown" })
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenLastCalledWith("diff:b.txt", "b.txt"),
		)

		// ArrowUp → back to first file.
		fireEvent.keyDown(list, { key: "ArrowUp" })
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenLastCalledWith("diff:a.txt", "a.txt"),
		)
	})
})

describe("CommitDetail ignoreWhitespace toggle", () => {
	it("re-fetches the open file's diff when ignoreWhitespace flips", async () => {
		commitFiles.mockClear()
		fileDiff.mockClear()
		commitFiles.mockResolvedValue({
			status: "ok",
			data: [{ status: "M", path: "a.txt" }],
		})
		fileDiff.mockResolvedValue({ status: "ok", data: "diff" })
		const commit = makeCommit("c1")

		const { rerender } = render(
			<CommitDetail
				repoPath="/repo"
				selectedCommit={commit}
				onFileDiff={() => {}}
				ignoreWhitespace={false}
			/>,
		)

		const aButton = await screen.findByText("a.txt")
		await userEvent.setup().click(aButton)

		await waitFor(() => expect(fileDiff).toHaveBeenCalledTimes(1))
		expect(fileDiff).toHaveBeenLastCalledWith(
			"/repo",
			"c1",
			"a.txt",
			false,
			false,
		)

		rerender(
			<CommitDetail
				repoPath="/repo"
				selectedCommit={commit}
				onFileDiff={() => {}}
				ignoreWhitespace={true}
			/>,
		)

		await waitFor(() => expect(fileDiff).toHaveBeenCalledTimes(2))
		expect(fileDiff).toHaveBeenLastCalledWith(
			"/repo",
			"c1",
			"a.txt",
			true,
			false,
		)
	})
})

describe("CommitDetail", () => {
	it("does not let a slower file-to-file diff response overwrite a later click", async () => {
		commitFiles.mockResolvedValue({
			status: "ok",
			data: [
				{ status: "M", path: "a.txt" },
				{ status: "A", path: "b.txt" },
			],
		})

		let resolveA: (value: { status: "ok"; data: string }) => void = () => {}
		const pendingA = new Promise<{ status: "ok"; data: string }>((resolve) => {
			resolveA = resolve
		})

		fileDiff.mockImplementation(
			(_repo: string, _hash: string, path: string) => {
				if (path === "a.txt") {
					return pendingA
				}
				if (path === "b.txt") {
					return Promise.resolve({ status: "ok", data: "BBB" })
				}
				return Promise.resolve({ status: "ok", data: "" })
			},
		)

		const onFileDiff = vi.fn()
		const user = userEvent.setup()

		render(
			<CommitDetail
				repoPath="/repo"
				selectedCommit={makeCommit("c1")}
				onFileDiff={onFileDiff}
				ignoreWhitespace={false}
			/>,
		)

		const aButton = await screen.findByText("a.txt")
		const bButton = await screen.findByText("b.txt")

		await user.click(aButton)
		await user.click(bButton)

		// b.txt's immediate response should have already applied.
		expect(onFileDiff).toHaveBeenLastCalledWith("BBB", "b.txt")

		// Now resolve a.txt's slow, stale response.
		resolveA({ status: "ok", data: "AAA" })
		// Flush microtasks.
		await Promise.resolve()
		await Promise.resolve()

		// The stale a.txt diff must NOT have overwritten b.txt's diff.
		expect(onFileDiff).toHaveBeenLastCalledWith("BBB", "b.txt")
		expect(onFileDiff).not.toHaveBeenLastCalledWith("AAA", "a.txt")
	})
})

describe("CommitDetail file-row context menu", () => {
	it("opens a menu with Copy Path To Clipboard and disabled WIP items on right-click", async () => {
		commitFiles.mockResolvedValue({
			status: "ok",
			data: [{ status: "M", path: "a.txt" }],
		})
		const user = userEvent.setup()

		render(
			<CommitDetail
				repoPath="/repo"
				selectedCommit={makeCommit("c1")}
				onFileDiff={() => {}}
				ignoreWhitespace={false}
			/>,
		)
		const row = await screen.findByText("a.txt")
		await user.pointer({ keys: "[MouseRight]", target: row })

		expect(screen.getByText("Copy Path To Clipboard")).toBeInTheDocument()
		const wipItem = screen.getByText("Log Selected…").closest("button")
		expect(wipItem).toBeDisabled()
	})

	it("copies the file path to the clipboard when Copy Path To Clipboard is clicked", async () => {
		commitFiles.mockResolvedValue({
			status: "ok",
			data: [{ status: "M", path: "a.txt" }],
		})
		// userEvent.setup() installs its own navigator.clipboard stub, so our
		// mock must replace it *after* setup() runs (the stub is left
		// configurable, so this simply swaps in ours for the assertion).
		const user = userEvent.setup()
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		})

		render(
			<CommitDetail
				repoPath="/repo"
				selectedCommit={makeCommit("c1")}
				onFileDiff={() => {}}
				ignoreWhitespace={false}
			/>,
		)
		const row = await screen.findByText("a.txt")
		await user.pointer({ keys: "[MouseRight]", target: row })

		await user.click(screen.getByText("Copy Path To Clipboard"))
		expect(writeText).toHaveBeenCalledWith("a.txt")
	})

	// The commit list only carries the subject, so the body is only readable
	// through this panel.
	it("shows the selected commit's full message below the file list", async () => {
		commitFiles.mockResolvedValue({ status: "ok", data: [] })
		commitMessage.mockResolvedValue({
			status: "ok",
			data: "the subject\n\nthe body nobody could read before",
		})

		render(
			<CommitDetail
				repoPath="/repo"
				selectedCommit={makeCommit("c1")}
				onFileDiff={() => {}}
				ignoreWhitespace={false}
			/>,
		)

		expect(await screen.findByLabelText("Commit message")).toHaveTextContent(
			"the body nobody could read before",
		)
		expect(commitMessage).toHaveBeenCalledWith("/repo", "c1")
	})
})
