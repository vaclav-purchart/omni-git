import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import type { FileFilter } from "./fileFilter"
import { WorkingCopyDetail } from "./WorkingCopyDetail"

const FILTERS_KEY = "file-filters"

function seedFilters(filters: FileFilter[]) {
	setSetting(FILTERS_KEY, JSON.stringify(filters))
}

beforeEach(() => {
	resetSettings()
})

const {
	workingStatus,
	workingFileDiff,
	repoOperation,
	operationAction,
	stageFile,
	unstageFile,
	stageAll,
	unstageAll,
	discardFile,
	stageTracked,
	stagePaths,
	unstagePaths,
	discardPaths,
	cleanPaths,
	discardAllUnstaged,
	cleanUntracked,
	commit,
	headCommitMessage,
	recentCommitMessages,
} = vi.hoisted(() => {
	// Every mutation resolves to an ok Result by default. A bare vi.fn() returns
	// undefined, and `runMutation` does `(await p).status` — which threw
	// ASYNCHRONOUSLY, after the assertion had already passed. The unhandled
	// rejections then destabilised the vitest workers, so whole test files were
	// silently dropped from some runs and the suite reported a different total
	// every time.
	const ok = () => vi.fn().mockResolvedValue({ status: "ok", data: null })
	return {
		workingStatus: vi.fn(),
		workingFileDiff: vi.fn(),
		// Nothing in progress: the normal case for every test here that is not
		// about conflicts.
		repoOperation: vi.fn().mockResolvedValue({
			status: "ok",
			data: {
				kind: null,
				conflicts: [],
				step: null,
				head_name: null,
				can_skip: false,
			},
		}),
		operationAction: vi.fn().mockResolvedValue({
			status: "ok",
			data: { ok: true, sha: null, output: "" },
		}),
		stageFile: ok(),
		unstageFile: ok(),
		stageAll: ok(),
		unstageAll: ok(),
		discardFile: ok(),
		stageTracked: ok(),
		stagePaths: ok(),
		cleanPaths: ok(),
		discardPaths: ok(),
		unstagePaths: ok(),
		discardAllUnstaged: ok(),
		cleanUntracked: ok(),
		commit: vi.fn(),
		headCommitMessage: vi.fn(),
		recentCommitMessages: vi.fn(),
	}
})

vi.mock("../ipc/bindings", () => ({
	commands: {
		workingStatus,
		workingFileDiff,
		repoOperation,
		operationAction,
		stageFile,
		unstageFile,
		stageAll,
		unstageAll,
		discardFile,
		stageTracked,
		stagePaths,
		unstagePaths,
		discardPaths,
		cleanPaths,
		discardAllUnstaged,
		cleanUntracked,
		commit,
		headCommitMessage,
		recentCommitMessages,
	},
}))

describe("WorkingCopyDetail", () => {
	it("renders staged/unstaged/untracked section headers with counts, and loads a staged file's diff on click", async () => {
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [{ status: "M", path: "staged.txt" }],
				unstaged: [{ status: "M", path: "unstaged.txt" }],
				untracked: [{ status: "A", path: "untracked.txt" }],
			},
		})
		workingFileDiff.mockResolvedValue({ status: "ok", data: "diff:staged" })
		const onFileDiff = vi.fn()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={onFileDiff}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		expect(await screen.findByText("staged.txt")).toBeInTheDocument()
		expect(screen.getByText("unstaged.txt")).toBeInTheDocument()
		expect(screen.getByText("untracked.txt")).toBeInTheDocument()

		// The two divisions lead; staged/unstaged/untracked are subtypes under them.
		// "Staged" has no heading of its own because it is the whole of its group —
		// "Staged in this commit / Staged" says the same thing twice.
		expect(screen.getByText("Staged in this commit")).toBeInTheDocument()
		expect(screen.getByText("Not in this commit")).toBeInTheDocument()
		expect(screen.queryByText("Staged")).not.toBeInTheDocument()
		expect(screen.getByText("Unstaged")).toBeInTheDocument()
		expect(screen.getByText("Untracked")).toBeInTheDocument()
		const counts = screen
			.getAllByText("1")
			.filter((el) => el.className.includes("wc-section-count"))
		expect(counts).toHaveLength(2)
		const groupCounts = screen
			.getAllByText(/^[12]$/)
			.filter((el) => el.className.includes("wc-group-count"))
			.map((el) => el.textContent)
		expect(groupCounts).toEqual(["1", "2"])

		const stagedButton = screen.getByText("staged.txt").closest("button")
		expect(stagedButton).not.toBeNull()
		if (stagedButton) {
			await userEvent.setup().click(stagedButton)
		}

		expect(workingFileDiff).toHaveBeenCalledWith(
			"/repo",
			"staged.txt",
			"Staged",
			false,
			false,
		)
		expect(onFileDiff).toHaveBeenLastCalledWith("diff:staged", "staged.txt")
	})
})

describe("WorkingCopyDetail ignoreWhitespace toggle", () => {
	it("re-fetches the open file's diff when ignoreWhitespace flips", async () => {
		workingStatus.mockClear()
		workingFileDiff.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [{ status: "M", path: "staged.txt" }],
				unstaged: [],
				untracked: [],
			},
		})
		workingFileDiff.mockResolvedValue({ status: "ok", data: "diff" })

		const { rerender } = render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		const stagedButton = await screen.findByText("staged.txt")
		await userEvent.setup().click(stagedButton.closest("button") as HTMLElement)

		await waitFor(() => expect(workingFileDiff).toHaveBeenCalledTimes(1))
		expect(workingFileDiff).toHaveBeenLastCalledWith(
			"/repo",
			"staged.txt",
			"Staged",
			false,
			false,
		)

		rerender(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={true}
				onMutated={vi.fn()}
			/>,
		)

		await waitFor(() => expect(workingFileDiff).toHaveBeenCalledTimes(2))
		expect(workingFileDiff).toHaveBeenLastCalledWith(
			"/repo",
			"staged.txt",
			"Staged",
			true,
			false,
		)
	})
})

describe("WorkingCopyDetail partially-staged (dual-key) handling", () => {
	it("treats the staged and unstaged rows for the same path as independent, both for clicks and for is-active highlighting", async () => {
		workingStatus.mockClear()
		workingFileDiff.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [{ status: "M", path: "same.txt" }],
				unstaged: [{ status: "M", path: "same.txt" }],
				untracked: [],
			},
		})
		workingFileDiff.mockImplementation(
			(_repo: string, path: string, section: string) =>
				Promise.resolve({ status: "ok", data: `diff:${section}:${path}` }),
		)
		const onFileDiff = vi.fn()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={onFileDiff}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		// No untracked files in this fixture, so each division holds exactly one
		// section and neither section heading is drawn — the group headings say it.
		await screen.findByText("Staged in this commit")
		await screen.findByText("Not in this commit")

		// Both rows for "same.txt" render (one per section).
		const rows = screen.getAllByText("same.txt")
		expect(rows).toHaveLength(2)

		const stagedRow = rows[0].closest("button") as HTMLElement
		const unstagedRow = rows[1].closest("button") as HTMLElement
		expect(stagedRow).not.toBe(unstagedRow)

		// Click the staged occurrence.
		await userEvent.setup().click(stagedRow)
		await waitFor(() =>
			expect(workingFileDiff).toHaveBeenLastCalledWith(
				"/repo",
				"same.txt",
				"Staged",
				false,
				false,
			),
		)
		expect(onFileDiff).toHaveBeenLastCalledWith(
			"diff:Staged:same.txt",
			"same.txt",
		)
		expect(stagedRow.className).toContain("is-active")
		expect(unstagedRow.className).not.toContain("is-active")

		// Click the unstaged occurrence.
		await userEvent.setup().click(unstagedRow)
		await waitFor(() =>
			expect(workingFileDiff).toHaveBeenLastCalledWith(
				"/repo",
				"same.txt",
				"Unstaged",
				false,
				false,
			),
		)
		expect(onFileDiff).toHaveBeenLastCalledWith(
			"diff:Unstaged:same.txt",
			"same.txt",
		)
		expect(unstagedRow.className).toContain("is-active")
		expect(stagedRow.className).not.toContain("is-active")
	})
})

describe("WorkingCopyDetail keyboard navigation across sections", () => {
	it("moves ArrowDown/ArrowUp across Staged -> Unstaged -> Untracked in order, and clamps at both ends", async () => {
		workingStatus.mockClear()
		workingFileDiff.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [{ status: "M", path: "s.txt" }],
				unstaged: [{ status: "M", path: "u.txt" }],
				untracked: [{ status: "A", path: "t.txt" }],
			},
		})
		workingFileDiff.mockImplementation(
			(_repo: string, path: string, section: string) =>
				Promise.resolve({ status: "ok", data: `diff:${section}:${path}` }),
		)
		const onFileDiff = vi.fn()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={onFileDiff}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		await screen.findByText("s.txt")
		const list = screen.getByRole("listbox", { name: "Uncommitted changes" })

		// First ArrowDown (nothing selected) -> first file (Staged).
		fireEvent.keyDown(list, { key: "ArrowDown" })
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenLastCalledWith("diff:Staged:s.txt", "s.txt"),
		)

		// ArrowDown -> Unstaged.
		fireEvent.keyDown(list, { key: "ArrowDown" })
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenLastCalledWith(
				"diff:Unstaged:u.txt",
				"u.txt",
			),
		)

		// ArrowDown -> Untracked.
		fireEvent.keyDown(list, { key: "ArrowDown" })
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenLastCalledWith(
				"diff:Untracked:t.txt",
				"t.txt",
			),
		)

		// ArrowDown again at the last file -> clamps, stays on Untracked.
		fireEvent.keyDown(list, { key: "ArrowDown" })
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenLastCalledWith(
				"diff:Untracked:t.txt",
				"t.txt",
			),
		)

		// ArrowUp -> back to Unstaged.
		fireEvent.keyDown(list, { key: "ArrowUp" })
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenLastCalledWith(
				"diff:Unstaged:u.txt",
				"u.txt",
			),
		)

		// ArrowUp -> back to Staged.
		fireEvent.keyDown(list, { key: "ArrowUp" })
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenLastCalledWith("diff:Staged:s.txt", "s.txt"),
		)

		// ArrowUp again at the first file -> clamps, stays on Staged.
		fireEvent.keyDown(list, { key: "ArrowUp" })
		await waitFor(() =>
			expect(onFileDiff).toHaveBeenLastCalledWith("diff:Staged:s.txt", "s.txt"),
		)
	})
})

describe("WorkingCopyDetail unmount guard", () => {
	it("drops a workingFileDiff resolution that arrives after the component has unmounted", async () => {
		workingStatus.mockClear()
		workingFileDiff.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [{ status: "M", path: "staged.txt" }],
				unstaged: [],
				untracked: [],
			},
		})
		let resolveDiff: (v: { status: "ok"; data: string }) => void = () => {}
		workingFileDiff.mockReturnValue(
			new Promise((resolve) => {
				resolveDiff = resolve
			}),
		)
		const onFileDiff = vi.fn()

		const { unmount } = render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={onFileDiff}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		const stagedButton = await screen.findByText("staged.txt")
		await userEvent.setup().click(stagedButton.closest("button") as HTMLElement)
		await waitFor(() => expect(workingFileDiff).toHaveBeenCalledTimes(1))

		onFileDiff.mockClear()
		unmount()

		resolveDiff({ status: "ok", data: "diff:staged" })
		// Flush the microtask queue so the (now-guarded) .then handler runs.
		await Promise.resolve()
		await Promise.resolve()

		expect(onFileDiff).not.toHaveBeenCalled()
	})
})

describe("WorkingCopyDetail stage/unstage actions", () => {
	it("clicking Stage on an unstaged file calls stageFile and then onMutated", async () => {
		workingStatus.mockClear()
		stageFile.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [{ status: "M", path: "u.txt" }],
				untracked: [],
			},
		})
		stageFile.mockResolvedValue({ status: "ok", data: null })
		const onMutated = vi.fn()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={onMutated}
			/>,
		)

		const stageBtn = await screen.findByRole("button", { name: "Stage" })
		await userEvent.setup().click(stageBtn)

		await waitFor(() =>
			expect(stageFile).toHaveBeenCalledWith("/repo", "u.txt"),
		)
		await waitFor(() => expect(onMutated).toHaveBeenCalled())
	})

	it("clicking Unstage on a staged file calls unstageFile and then onMutated", async () => {
		workingStatus.mockClear()
		unstageFile.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [{ status: "M", path: "s.txt" }],
				unstaged: [],
				untracked: [],
			},
		})
		unstageFile.mockResolvedValue({ status: "ok", data: null })
		const onMutated = vi.fn()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={onMutated}
			/>,
		)

		const unstageBtn = await screen.findByRole("button", { name: "Unstage" })
		await userEvent.setup().click(unstageBtn)

		await waitFor(() =>
			expect(unstageFile).toHaveBeenCalledWith("/repo", "s.txt"),
		)
		await waitFor(() => expect(onMutated).toHaveBeenCalled())
	})

	it("clicking Stage all calls stageAll", async () => {
		workingStatus.mockClear()
		stageAll.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [{ status: "M", path: "u.txt" }],
				untracked: [],
			},
		})
		stageAll.mockResolvedValue({ status: "ok", data: null })
		const onMutated = vi.fn()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={onMutated}
			/>,
		)

		const btn = await screen.findByRole("button", { name: "Stage all" })
		await userEvent.setup().click(btn)

		await waitFor(() => expect(stageAll).toHaveBeenCalledWith("/repo"))
		await waitFor(() => expect(onMutated).toHaveBeenCalled())
	})

	it("clicking Unstage all calls unstageAll", async () => {
		workingStatus.mockClear()
		unstageAll.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [{ status: "M", path: "s.txt" }],
				unstaged: [],
				untracked: [],
			},
		})
		unstageAll.mockResolvedValue({ status: "ok", data: null })
		const onMutated = vi.fn()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={onMutated}
			/>,
		)

		const btn = await screen.findByRole("button", { name: "Unstage all" })
		await userEvent.setup().click(btn)

		await waitFor(() => expect(unstageAll).toHaveBeenCalledWith("/repo"))
		await waitFor(() => expect(onMutated).toHaveBeenCalled())
	})
})

describe("WorkingCopyDetail discard confirm flow", () => {
	it("Discard opens the confirm dialog and does not call discardFile until confirmed; Cancel calls nothing", async () => {
		workingStatus.mockClear()
		discardFile.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [{ status: "M", path: "u.txt" }],
				untracked: [],
			},
		})

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		const discardBtn = await screen.findByRole("button", { name: "Discard" })
		await userEvent.setup().click(discardBtn)

		const dialog = await screen.findByRole("alertdialog")
		expect(discardFile).not.toHaveBeenCalled()

		const cancelBtn = within(dialog).getByRole("button", { name: "Cancel" })
		await userEvent.setup().click(cancelBtn)

		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
		expect(discardFile).not.toHaveBeenCalled()
	})

	it("confirming Discard calls discardFile(repoPath, path, false) for an unstaged file", async () => {
		workingStatus.mockClear()
		discardFile.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [{ status: "M", path: "u.txt" }],
				untracked: [],
			},
		})
		discardFile.mockResolvedValue({ status: "ok", data: null })
		const onMutated = vi.fn()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={onMutated}
			/>,
		)

		const discardBtn = await screen.findByRole("button", { name: "Discard" })
		await userEvent.setup().click(discardBtn)

		const dialog = await screen.findByRole("alertdialog")
		const confirmBtn = within(dialog).getByRole("button", { name: "Discard" })
		await userEvent.setup().click(confirmBtn)

		await waitFor(() =>
			expect(discardFile).toHaveBeenCalledWith("/repo", "u.txt", false),
		)
		await waitFor(() => expect(onMutated).toHaveBeenCalled())
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
	})

	it("confirming Remove calls discardFile(repoPath, path, true) for an untracked file", async () => {
		workingStatus.mockClear()
		discardFile.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [],
				untracked: [{ status: "A", path: "t.txt" }],
			},
		})
		discardFile.mockResolvedValue({ status: "ok", data: null })
		const onMutated = vi.fn()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={onMutated}
			/>,
		)

		const removeBtn = await screen.findByRole("button", { name: "Remove" })
		await userEvent.setup().click(removeBtn)

		const dialog = await screen.findByRole("alertdialog")
		const confirmBtn = within(dialog).getByRole("button", { name: "Delete" })
		await userEvent.setup().click(confirmBtn)

		await waitFor(() =>
			expect(discardFile).toHaveBeenCalledWith("/repo", "t.txt", true),
		)
		await waitFor(() => expect(onMutated).toHaveBeenCalled())
	})
})

describe("WorkingCopyDetail failed mutation", () => {
	it("shows a dismissable inline banner (not the full-panel empty state) on a failed mutation, and Dismiss clears it", async () => {
		workingStatus.mockClear()
		stageFile.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [{ status: "M", path: "u.txt" }],
				untracked: [],
			},
		})
		stageFile.mockResolvedValue({
			status: "error",
			error: { NonZero: { code: 1, stderr: "boom" } },
		})
		const onMutated = vi.fn()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={onMutated}
			/>,
		)

		const stageBtn = await screen.findByRole("button", { name: "Stage" })
		await userEvent.setup().click(stageBtn)

		expect(await screen.findByText("boom")).toBeInTheDocument()
		// The toolbar + file list must still be visible; a failed mutation
		// must not fall back to the full-panel empty/error state.
		expect(
			screen.getByRole("button", { name: "Stage all" }),
		).toBeInTheDocument()
		expect(screen.getByText("u.txt")).toBeInTheDocument()
		expect(onMutated).not.toHaveBeenCalled()

		const dismissBtn = screen.getByRole("button", { name: "Dismiss" })
		await userEvent.setup().click(dismissBtn)

		expect(screen.queryByText("boom")).not.toBeInTheDocument()
		// Dismissing the banner must not nuke the panel either.
		expect(screen.getByText("u.txt")).toBeInTheDocument()
	})
})

describe("WorkingCopyDetail action button stopPropagation", () => {
	it("clicking an action button does not also open the file diff", async () => {
		workingStatus.mockClear()
		workingFileDiff.mockClear()
		stageFile.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [{ status: "M", path: "u.txt" }],
				untracked: [],
			},
		})
		stageFile.mockResolvedValue({ status: "ok", data: null })

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		const stageBtn = await screen.findByRole("button", { name: "Stage" })
		await userEvent.setup().click(stageBtn)

		await waitFor(() =>
			expect(stageFile).toHaveBeenCalledWith("/repo", "u.txt"),
		)
		expect(workingFileDiff).not.toHaveBeenCalled()
	})
})

describe("WorkingCopyDetail file-row context menu", () => {
	it("right-clicking an Unstaged file opens a menu with Stage, Discard…, and Copy Path To Clipboard", async () => {
		workingStatus.mockClear()
		stageFile.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [{ status: "M", path: "u.txt" }],
				untracked: [],
			},
		})
		const user = userEvent.setup()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		const row = await screen.findByText("u.txt")
		await user.pointer({ keys: "[MouseRight]", target: row })

		expect(screen.getByRole("menuitem", { name: "Stage" })).toBeInTheDocument()
		expect(
			screen.getByRole("menuitem", { name: "Discard…" }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("menuitem", { name: "Copy Path To Clipboard" }),
		).toBeInTheDocument()
	})

	it("clicking Stage in the menu calls commands.stageFile", async () => {
		workingStatus.mockClear()
		stageFile.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [{ status: "M", path: "u.txt" }],
				untracked: [],
			},
		})
		stageFile.mockResolvedValue({ status: "ok", data: null })
		const onMutated = vi.fn()
		const user = userEvent.setup()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={onMutated}
			/>,
		)

		const row = await screen.findByText("u.txt")
		await user.pointer({ keys: "[MouseRight]", target: row })

		await user.click(screen.getByRole("menuitem", { name: "Stage" }))

		await waitFor(() =>
			expect(stageFile).toHaveBeenCalledWith("/repo", "u.txt"),
		)
		await waitFor(() => expect(onMutated).toHaveBeenCalled())
	})

	it("clicking Discard… in the menu opens the confirm dialog without calling discardFile", async () => {
		workingStatus.mockClear()
		discardFile.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [{ status: "M", path: "u.txt" }],
				untracked: [],
			},
		})
		const user = userEvent.setup()

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		const row = await screen.findByText("u.txt")
		await user.pointer({ keys: "[MouseRight]", target: row })

		await user.click(screen.getByRole("menuitem", { name: "Discard…" }))

		const dialog = await screen.findByRole("alertdialog")
		expect(discardFile).not.toHaveBeenCalled()

		const confirmBtn = within(dialog).getByRole("button", { name: "Discard" })
		await user.click(confirmBtn)

		await waitFor(() =>
			expect(discardFile).toHaveBeenCalledWith("/repo", "u.txt", false),
		)
	})
})

describe("WorkingCopyDetail file filters (via FileList)", () => {
	it("shows a 'Hide tests' toggle that hides .test./.spec. files across all groups", async () => {
		workingStatus.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [
					{ status: "M", path: "a.ts" },
					{ status: "A", path: "a.test.ts" },
				],
				unstaged: [{ status: "M", path: "b.spec.ts" }],
				untracked: [{ status: "A", path: "c.ts" }],
			},
		})

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		expect(await screen.findByText("a.test.ts")).toBeInTheDocument()
		expect(screen.getByText("b.spec.ts")).toBeInTheDocument()

		const hideTestsBtn = screen.getByRole("button", { name: /Hide tests/ })
		await userEvent.setup().click(hideTestsBtn)

		expect(screen.queryByText("a.test.ts")).not.toBeInTheDocument()
		expect(screen.queryByText("b.spec.ts")).not.toBeInTheDocument()
		expect(screen.getByText("a.ts")).toBeInTheDocument()
		expect(screen.getByText("c.ts")).toBeInTheDocument()
	})

	it("removes a row matching a seeded hide filter from its group", async () => {
		seedFilters([{ id: "f1", pattern: "b.ts", mode: "hide", enabled: true }])
		workingStatus.mockClear()
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [],
				unstaged: [
					{ status: "M", path: "a.ts" },
					{ status: "M", path: "b.ts" },
				],
				untracked: [],
			},
		})

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		expect(await screen.findByText("a.ts")).toBeInTheDocument()
		expect(screen.queryByText("b.ts")).not.toBeInTheDocument()
	})

	it("renders the commit box under the file list", async () => {
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [{ status: "M", path: "staged.txt" }],
				unstaged: [],
				untracked: [],
			},
		})

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		expect(await screen.findByLabelText("Commit message")).toBeInTheDocument()
		expect(screen.getByText("1 staged file")).toBeInTheDocument()
	})

	// `head: null` is an unborn branch — there is no commit to amend.
	it("disables amend when the repo has no commits yet", async () => {
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: null,
				staged: [{ status: "A", path: "first.txt" }],
				unstaged: [],
				untracked: [],
			},
		})

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		expect(await screen.findByLabelText(/Amend last commit/)).toBeDisabled()
	})

	it("focuses the commit message box on Cmd/Ctrl+Enter from the file list", async () => {
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [{ status: "M", path: "staged.txt" }],
				unstaged: [],
				untracked: [],
			},
		})

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)
		const row = await screen.findByText("staged.txt")

		fireEvent.keyDown(row, { key: "Enter", ctrlKey: true })

		expect(screen.getByLabelText("Commit message")).toHaveFocus()
	})

	it("expands a collapsed commit box before focusing it", async () => {
		setSetting("commit-box-open", "false")
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "deadbeef",
				staged: [{ status: "M", path: "staged.txt" }],
				unstaged: [],
				untracked: [],
			},
		})

		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)
		const row = await screen.findByText("staged.txt")
		expect(screen.queryByLabelText("Commit message")).not.toBeInTheDocument()

		fireEvent.keyDown(row, { key: "Enter", ctrlKey: true })

		await waitFor(() => {
			expect(screen.getByLabelText("Commit message")).toHaveFocus()
		})
	})
})

describe("WorkingCopyDetail in-place reload", () => {
	// This file doesn't reset mocks globally, so counts would otherwise carry
	// over from the tests above.
	beforeEach(() => {
		workingStatus.mockReset()
		workingFileDiff.mockReset()
	})

	function statusOf(
		staged: Array<{ status: string; path: string }>,
		unstaged: Array<{ status: string; path: string }>,
		untracked: Array<{ status: string; path: string }> = [],
	) {
		return {
			status: "ok",
			data: { head: "deadbeef", staged, unstaged, untracked },
		}
	}

	// THE no-blink invariant: bumping reloadToken re-reads in place. The file
	// list must never empty out while the fetch is in flight — clearing it (which
	// a remount did) is what made the panel flash on every stage/unstage.
	it("keeps the file list on screen while re-reading", async () => {
		workingStatus.mockResolvedValueOnce(
			statusOf([], [{ status: "M", path: "a.ts" }]),
		)
		const { rerender } = render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
				reloadToken={0}
			/>,
		)
		expect(await screen.findByText("a.ts")).toBeInTheDocument()

		let resolveReload: (v: unknown) => void = () => {}
		workingStatus.mockReturnValueOnce(
			new Promise((res) => {
				resolveReload = res
			}),
		)
		rerender(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
				reloadToken={1}
			/>,
		)

		// Mid-flight, with no new data yet: the row is still there.
		expect(screen.getByText("a.ts")).toBeInTheDocument()

		await waitFor(() => expect(workingStatus).toHaveBeenCalledTimes(2))
		resolveReload(statusOf([{ status: "M", path: "a.ts" }], []))
		await waitFor(() =>
			expect(screen.getByText("Staged in this commit")).toBeInTheDocument(),
		)
		expect(screen.getByText("a.ts")).toBeInTheDocument()
	})

	// Switching repo is different: that data belongs to another repo and must go.
	it("does clear when the repo changes", async () => {
		workingStatus.mockResolvedValue(
			statusOf([], [{ status: "M", path: "a.ts" }]),
		)
		const { rerender } = render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)
		expect(await screen.findByText("a.ts")).toBeInTheDocument()

		workingStatus.mockReturnValueOnce(new Promise(() => {}))
		rerender(
			<WorkingCopyDetail
				repoPath="/other"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)

		expect(screen.queryByText("a.ts")).not.toBeInTheDocument()
	})

	// Staging MOVES a file between sections, so the open-file key stops matching.
	// Following it keeps the diff you were reading on screen instead of blanking.
	it("follows the open file when staging moves it to another section", async () => {
		workingStatus.mockResolvedValueOnce(
			statusOf([], [{ status: "M", path: "a.ts" }]),
		)
		workingFileDiff.mockResolvedValue({ status: "ok", data: "diff:a" })
		const onFileDiff = vi.fn()
		const { rerender } = render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={onFileDiff}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
				reloadToken={0}
			/>,
		)
		await userEvent.click(await screen.findByText("a.ts"))
		await waitFor(() =>
			expect(workingFileDiff).toHaveBeenCalledWith(
				"/repo",
				"a.ts",
				"Unstaged",
				false,
				false,
			),
		)
		// The mount-time clear already happened and is legitimate; what matters is
		// that the RELOAD doesn't blank the diff.
		onFileDiff.mockClear()

		// Now it's staged, and the reload reports it in the Staged section.
		workingStatus.mockResolvedValueOnce(
			statusOf([{ status: "M", path: "a.ts" }], []),
		)
		rerender(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={onFileDiff}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
				reloadToken={1}
			/>,
		)

		await waitFor(() =>
			expect(workingFileDiff).toHaveBeenCalledWith(
				"/repo",
				"a.ts",
				"Staged",
				false,
				false,
			),
		)
		// Never blanked on the way.
		expect(onFileDiff).not.toHaveBeenCalledWith("", null)
	})

	// A file that genuinely went away (committed, discarded) must clear the diff.
	it("clears the diff when the open file is gone", async () => {
		workingStatus.mockResolvedValueOnce(
			statusOf([], [{ status: "M", path: "a.ts" }]),
		)
		workingFileDiff.mockResolvedValue({ status: "ok", data: "diff:a" })
		const onFileDiff = vi.fn()
		const { rerender } = render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={onFileDiff}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
				reloadToken={0}
			/>,
		)
		await userEvent.click(await screen.findByText("a.ts"))
		await waitFor(() => expect(workingFileDiff).toHaveBeenCalled())
		onFileDiff.mockClear()

		workingStatus.mockResolvedValueOnce(statusOf([], []))
		rerender(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={onFileDiff}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
				reloadToken={1}
			/>,
		)

		await waitFor(() => expect(onFileDiff).toHaveBeenCalledWith("", null))
	})
})

describe("WorkingCopyDetail selection after acting on a row", () => {
	beforeEach(() => {
		workingStatus.mockReset()
		workingFileDiff.mockReset()
		stageFile.mockReset()
		stageFile.mockResolvedValue({ status: "ok", data: null })
		workingFileDiff.mockResolvedValue({ status: "ok", data: "diff" })
	})

	function statusOf(
		staged: Array<{ status: string; path: string }>,
		unstaged: Array<{ status: string; path: string }>,
	) {
		return {
			status: "ok",
			data: { head: "h", staged, unstaged, untracked: [] },
		}
	}

	function props(reloadToken: number) {
		return {
			repoPath: "/repo",
			onFileDiff: () => {},
			ignoreWhitespace: false,
			onMutated: vi.fn(),
			reloadToken,
		}
	}

	// Working down a list of changes: staging the file you just reviewed should
	// leave you on the NEXT one, not follow the file into the Staged section.
	it("selects the file below after staging the active one", async () => {
		workingStatus.mockResolvedValueOnce(
			statusOf(
				[],
				[
					{ status: "M", path: "a.ts" },
					{ status: "M", path: "b.ts" },
				],
			),
		)
		const { rerender } = render(<WorkingCopyDetail {...props(0)} />)
		await userEvent.click(await screen.findByText("a.ts"))
		await waitFor(() =>
			expect(workingFileDiff).toHaveBeenLastCalledWith(
				"/repo",
				"a.ts",
				"Unstaged",
				false,
				false,
			),
		)

		const rows = screen.getAllByRole("button", { name: "Stage" })
		await userEvent.click(rows[0])
		await waitFor(() => expect(stageFile).toHaveBeenCalled())

		// The reload the mutation triggers: a.ts is staged, b.ts took its place.
		workingStatus.mockResolvedValueOnce(
			statusOf(
				[{ status: "M", path: "a.ts" }],
				[{ status: "M", path: "b.ts" }],
			),
		)
		rerender(<WorkingCopyDetail {...props(1)} />)

		await waitFor(() =>
			expect(workingFileDiff).toHaveBeenLastCalledWith(
				"/repo",
				"b.ts",
				"Unstaged",
				false,
				false,
			),
		)
	})

	// Nothing below it, so fall back to the row that is now last.
	it("selects the previous file when the last one is staged", async () => {
		workingStatus.mockResolvedValueOnce(
			statusOf(
				[],
				[
					{ status: "M", path: "a.ts" },
					{ status: "M", path: "b.ts" },
				],
			),
		)
		const { rerender } = render(<WorkingCopyDetail {...props(0)} />)
		await userEvent.click(await screen.findByText("b.ts"))
		await waitFor(() => expect(workingFileDiff).toHaveBeenCalled())

		await userEvent.click(screen.getAllByRole("button", { name: "Stage" })[1])
		await waitFor(() => expect(stageFile).toHaveBeenCalled())

		workingStatus.mockResolvedValueOnce(
			statusOf(
				[{ status: "M", path: "b.ts" }],
				[{ status: "M", path: "a.ts" }],
			),
		)
		rerender(<WorkingCopyDetail {...props(1)} />)

		await waitFor(() =>
			expect(workingFileDiff).toHaveBeenLastCalledWith(
				"/repo",
				"a.ts",
				"Unstaged",
				false,
				false,
			),
		)
	})

	// Acting on a row you are NOT reading must not yank the diff away from the one
	// you are — the selection only follows an action on the ACTIVE row.
	it("leaves the selection alone when acting on a different row", async () => {
		workingStatus.mockResolvedValueOnce(
			statusOf(
				[],
				[
					{ status: "M", path: "a.ts" },
					{ status: "M", path: "b.ts" },
				],
			),
		)
		const { rerender } = render(<WorkingCopyDetail {...props(0)} />)
		await userEvent.click(await screen.findByText("a.ts"))
		await waitFor(() => expect(workingFileDiff).toHaveBeenCalled())
		workingFileDiff.mockClear()

		// Stage the OTHER row.
		await userEvent.click(screen.getAllByRole("button", { name: "Stage" })[1])
		await waitFor(() => expect(stageFile).toHaveBeenCalled())

		workingStatus.mockResolvedValueOnce(
			statusOf(
				[{ status: "M", path: "b.ts" }],
				[{ status: "M", path: "a.ts" }],
			),
		)
		rerender(<WorkingCopyDetail {...props(1)} />)

		await waitFor(() => expect(workingFileDiff).toHaveBeenCalled())
		expect(workingFileDiff).toHaveBeenLastCalledWith(
			"/repo",
			"a.ts",
			"Unstaged",
			false,
			false,
		)
	})
})

describe("WorkingCopyDetail group actions", () => {
	beforeEach(() => {
		workingStatus.mockReset()
		// Clear CALL HISTORY too, not just the implementation: these mocks are
		// shared across the file, so a previous test's call would otherwise make a
		// "was not called" assertion pass or fail for the wrong reason.
		for (const m of [
			stageTracked,
			stagePaths,
			unstageAll,
			discardAllUnstaged,
			cleanUntracked,
		]) {
			m.mockClear()
		}
		stageTracked.mockResolvedValue({ status: "ok", data: null })
		stagePaths.mockResolvedValue({ status: "ok", data: null })
		unstageAll.mockResolvedValue({ status: "ok", data: null })
		discardAllUnstaged.mockResolvedValue({ status: "ok", data: null })
		cleanUntracked.mockResolvedValue({ status: "ok", data: null })
	})

	function renderWithGroups() {
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "h",
				staged: [{ status: "M", path: "s1.ts" }],
				unstaged: [
					{ status: "M", path: "u1.ts" },
					{ status: "M", path: "u2.ts" },
				],
				untracked: [{ status: "?", path: "n1.ts" }],
			},
		})
		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)
	}

	it("unstages the whole staged group", async () => {
		renderWithGroups()

		await userEvent.click(
			await screen.findByLabelText("Unstage all 1 staged files"),
		)

		expect(unstageAll).toHaveBeenCalledWith("/repo")
	})

	// `add -u`, not `add -A`: staging the Unstaged group must leave untracked
	// files alone.
	it("stages only tracked files for the unstaged group", async () => {
		renderWithGroups()

		await userEvent.click(
			await screen.findByLabelText("Stage all 2 unstaged files"),
		)

		expect(stageTracked).toHaveBeenCalledWith("/repo")
	})

	// git has no "all untracked" pathspec, so the group's paths are passed.
	it("stages the untracked group by path", async () => {
		renderWithGroups()

		await userEvent.click(
			await screen.findByLabelText("Stage all 1 untracked files"),
		)

		expect(stagePaths).toHaveBeenCalledWith("/repo", ["n1.ts"])
	})

	it("confirms before discarding the unstaged group", async () => {
		renderWithGroups()

		await userEvent.click(
			await screen.findByLabelText("Discard all 2 unstaged changes"),
		)
		expect(discardAllUnstaged).not.toHaveBeenCalled()

		const dialog = document.querySelector(".confirm-dialog") as HTMLElement
		await userEvent.click(
			within(dialog).getByRole("button", { name: "Discard" }),
		)
		expect(discardAllUnstaged).toHaveBeenCalledWith("/repo")
	})

	it("confirms before deleting the untracked group", async () => {
		renderWithGroups()

		await userEvent.click(
			await screen.findByLabelText("Delete all 1 untracked files"),
		)
		expect(cleanUntracked).not.toHaveBeenCalled()

		const dialog = document.querySelector(".confirm-dialog") as HTMLElement
		await userEvent.click(
			within(dialog).getByRole("button", { name: "Delete" }),
		)
		expect(cleanUntracked).toHaveBeenCalledWith("/repo")
	})

	it("does nothing when a group confirm is cancelled", async () => {
		renderWithGroups()

		await userEvent.click(
			await screen.findByLabelText("Delete all 1 untracked files"),
		)
		const dialog = document.querySelector(".confirm-dialog") as HTMLElement
		await userEvent.click(
			within(dialog).getByRole("button", { name: "Cancel" }),
		)

		expect(cleanUntracked).not.toHaveBeenCalled()
	})

	// An empty group has nothing to act on.
	it("offers no actions for an empty group", async () => {
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "h",
				staged: [],
				unstaged: [{ status: "M", path: "u1.ts" }],
				untracked: [],
			},
		})
		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)
		await screen.findByText("u1.ts")

		// Anchored: /staged files/ alone also matches "unstaged files".
		expect(screen.queryByLabelText(/^Unstage all/)).not.toBeInTheDocument()
		expect(screen.queryByLabelText(/untracked files/)).not.toBeInTheDocument()
	})

	// The header has room, so these are real buttons with words on them. The count
	// keeps them short and distinguishes them from the toolbar's repo-wide
	// "Stage all"/"Unstage all".
	it("labels the group buttons with a verb and the count", async () => {
		renderWithGroups()
		await screen.findByText("s1.ts")

		expect(screen.getByText("Unstage 1")).toBeInTheDocument()
		expect(screen.getByText("Stage 2")).toBeInTheDocument()
		expect(screen.getByText("Discard 2")).toBeInTheDocument()
		expect(screen.getByText("Stage 1")).toBeInTheDocument()
		expect(screen.getByText("Delete 1")).toBeInTheDocument()
	})

	// The toolbar acts on the whole repo, the header buttons on one group; they
	// must not read as the same control.
	it("keeps group labels distinct from the repo-wide toolbar", async () => {
		renderWithGroups()
		await screen.findByText("s1.ts")

		expect(screen.getAllByText("Stage all")).toHaveLength(1)
		expect(screen.getAllByText("Unstage all")).toHaveLength(1)
	})
})

// Shift+click and Cmd/Ctrl+click, so a group of files can be staged in one go
// rather than one click per file.
describe("multi-selection", () => {
	// These mocks live at module scope, so a call made by one test is still on the
	// record in the next one.
	beforeEach(() => {
		stagePaths.mockClear()
		unstagePaths.mockClear()
		discardPaths.mockClear()
		cleanPaths.mockClear()
	})

	function renderRows() {
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "h",
				staged: [{ status: "M", path: "s1.ts" }],
				unstaged: [
					{ status: "M", path: "u1.ts" },
					{ status: "M", path: "u2.ts" },
					{ status: "M", path: "u3.ts" },
				],
				untracked: [{ status: "?", path: "n1.ts" }],
			},
		})
		workingFileDiff.mockResolvedValue({ status: "ok", data: "" })
		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)
	}

	function row(path: string) {
		return screen.getByText(path).closest("button") as HTMLElement
	}

	async function selectRange(from: string, to: string) {
		const user = userEvent.setup()
		await user.click(await screen.findByText(from))
		fireEvent.click(row(to), { shiftKey: true })
		return user
	}

	it("selects a range with shift+click and stages it in one command", async () => {
		renderRows()
		const user = await selectRange("u1.ts", "u3.ts")

		expect(screen.getByText("3 selected")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: /Stage 3/ }))

		expect(stagePaths).toHaveBeenCalledWith("/repo", [
			"u1.ts",
			"u2.ts",
			"u3.ts",
		])
	})

	// A range dragged upwards is the same range; the paths must still reach git in
	// display order.
	it("selects the same range when dragged upwards", async () => {
		renderRows()
		const user = await selectRange("u3.ts", "u1.ts")

		await user.click(screen.getByRole("button", { name: /Stage 3/ }))

		expect(stagePaths).toHaveBeenCalledWith("/repo", [
			"u1.ts",
			"u2.ts",
			"u3.ts",
		])
	})

	it("adds individual rows with ctrl+click", async () => {
		renderRows()
		const user = userEvent.setup()
		await user.click(await screen.findByText("u1.ts"))
		fireEvent.click(row("u3.ts"), { ctrlKey: true })

		expect(screen.getByText("2 selected")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: /Stage 2/ }))

		expect(stagePaths).toHaveBeenCalledWith("/repo", ["u1.ts", "u3.ts"])
	})

	it("removes a row when ctrl+clicked again", async () => {
		renderRows()
		const user = await selectRange("u1.ts", "u3.ts")
		expect(screen.getByText("3 selected")).toBeInTheDocument()

		fireEvent.click(row("u2.ts"), { metaKey: true })

		expect(screen.getByText("2 selected")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: /Stage 2/ }))
		expect(stagePaths).toHaveBeenCalledWith("/repo", ["u1.ts", "u3.ts"])
	})

	// git add treats a modified tracked file and a brand-new one the same, so a
	// mixed selection is one command rather than two.
	it("stages unstaged and untracked files together", async () => {
		renderRows()
		const user = await selectRange("u3.ts", "n1.ts")

		await user.click(screen.getByRole("button", { name: /Stage 2/ }))

		expect(stagePaths).toHaveBeenCalledWith("/repo", ["u3.ts", "n1.ts"])
	})

	// A selection can span sections, and then both directions are legitimate — so
	// each action reports its own count instead of one winning.
	it("offers stage and unstage separately when the selection spans sections", async () => {
		renderRows()
		await selectRange("s1.ts", "u2.ts")

		expect(screen.getByRole("button", { name: /Stage 2/ })).toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: /Unstage 1/ }),
		).toBeInTheDocument()
	})

	it("unstages a selection in one command", async () => {
		renderRows()
		const user = userEvent.setup()
		await user.click(await screen.findByText("s1.ts"))
		fireEvent.click(row("u1.ts"), { ctrlKey: true })

		await user.click(screen.getByRole("button", { name: /Unstage 1/ }))

		expect(unstagePaths).toHaveBeenCalledWith("/repo", ["s1.ts"])
	})

	// Discarding tracked edits and deleting untracked files are different enough
	// that one button must not do both silently.
	it("keeps discard and delete apart for a mixed selection", async () => {
		renderRows()
		const user = await selectRange("u3.ts", "n1.ts")

		await user.click(screen.getByRole("button", { name: /Discard 1/ }))
		const dialog = screen.getByRole("alertdialog")
		await user.click(within(dialog).getByRole("button", { name: "Discard" }))

		expect(discardPaths).toHaveBeenCalledWith("/repo", ["u3.ts"])
		expect(cleanPaths).not.toHaveBeenCalled()
	})

	it("deletes selected untracked files after confirming", async () => {
		renderRows()
		const user = await selectRange("u3.ts", "n1.ts")

		await user.click(screen.getByRole("button", { name: /Delete 1/ }))
		const dialog = screen.getByRole("alertdialog")
		await user.click(within(dialog).getByRole("button", { name: "Delete" }))

		expect(cleanPaths).toHaveBeenCalledWith("/repo", ["n1.ts"])
	})

	it("does not discard when the confirmation is cancelled", async () => {
		renderRows()
		const user = await selectRange("u1.ts", "u3.ts")

		await user.click(screen.getByRole("button", { name: /Discard 3/ }))
		const dialog = screen.getByRole("alertdialog")
		await user.click(within(dialog).getByRole("button", { name: "Cancel" }))

		expect(discardPaths).not.toHaveBeenCalled()
	})

	// Leaving a selection standing after the user has clicked elsewhere would make
	// the next action apply to rows they thought they had moved off.
	it("clears the selection on a plain click", async () => {
		renderRows()
		const user = await selectRange("u1.ts", "u3.ts")
		expect(screen.getByText("3 selected")).toBeInTheDocument()

		await user.click(screen.getByText("u2.ts"))

		expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
	})

	// One row selected is just the active row; the bar would be noise.
	it("shows no bar for a single row", async () => {
		renderRows()
		await userEvent.click(await screen.findByText("u1.ts"))

		expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
	})

	it("clears the selection with the bar's close button", async () => {
		renderRows()
		const user = await selectRange("u1.ts", "u3.ts")

		await user.click(screen.getByRole("button", { name: "Clear selection" }))

		expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
	})

	describe("context menu", () => {
		it("acts on the whole selection when opened inside it", async () => {
			renderRows()
			await selectRange("u1.ts", "u3.ts")

			fireEvent.contextMenu(row("u2.ts"))

			expect(await screen.findByText("Stage 3 files")).toBeInTheDocument()
		})

		// A row outside the selection isn't what was aimed at, so its own menu opens
		// — acting on 3 files after right-clicking a fourth would be a nasty surprise.
		it("falls back to the row's own menu outside the selection", async () => {
			renderRows()
			await selectRange("u1.ts", "u2.ts")

			fireEvent.contextMenu(row("n1.ts"))

			expect(screen.queryByText("Stage 2 files")).not.toBeInTheDocument()
			expect(
				await screen.findByRole("menuitem", { name: "Stage" }),
			).toBeInTheDocument()
		})
	})

	it("selects every file with cmd+a, across all the divisions", async () => {
		renderRows()
		await screen.findByText("s1.ts")

		fireEvent.keyDown(
			screen.getByRole("listbox", { name: "Uncommitted changes" }),
			{ code: "KeyA", metaKey: true },
		)

		// 1 staged + 3 unstaged + 1 untracked.
		expect(screen.getByText("5 selected")).toBeInTheDocument()
		// And the actions are offered per division, as for any other selection.
		expect(screen.getByRole("button", { name: /Stage 4/ })).toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: /Unstage 1/ }),
		).toBeInTheDocument()
	})

	// Shift+Arrow has to grow from the anchor, not re-anchor each press — otherwise
	// the range could never be more than two rows.
	it("extends the selection with shift+arrow", async () => {
		renderRows()
		const user = userEvent.setup()
		await user.click(await screen.findByText("u1.ts"))

		const list = screen.getByRole("listbox", { name: "Uncommitted changes" })
		fireEvent.keyDown(list, { key: "ArrowDown", shiftKey: true })
		fireEvent.keyDown(list, { key: "ArrowDown", shiftKey: true })

		expect(screen.getByText("3 selected")).toBeInTheDocument()
	})
})

// Preparing a commit is a question of what IS in it and what isn't; staged,
// unstaged and untracked are subtypes of that answer rather than three peers.
describe("the in/out-of-commit division", () => {
	function renderWith(data: {
		staged?: Array<{ status: string; path: string }>
		unstaged?: Array<{ status: string; path: string }>
		untracked?: Array<{ status: string; path: string }>
	}) {
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "h",
				staged: data.staged ?? [],
				unstaged: data.unstaged ?? [],
				untracked: data.untracked ?? [],
			},
		})
		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
			/>,
		)
	}

	it("counts a whole division, not just one of its sections", async () => {
		renderWith({
			staged: [{ status: "M", path: "s.ts" }],
			unstaged: [{ status: "M", path: "u.ts" }],
			untracked: [{ status: "?", path: "n.ts" }],
		})
		await screen.findByText("Not in this commit")

		const count = screen
			.getAllByText("2")
			.find((el) => el.className.includes("wc-group-count"))
		expect(count).toBeDefined()
	})

	it("keeps the subtypes visible under the division", async () => {
		renderWith({
			unstaged: [{ status: "M", path: "u.ts" }],
			untracked: [{ status: "?", path: "n.ts" }],
		})
		await screen.findByText("Not in this commit")

		expect(screen.getByText("Unstaged")).toBeInTheDocument()
		expect(screen.getByText("Untracked")).toBeInTheDocument()
	})

	// A heading for a division with nothing under it is a heading for nothing.
	it("omits a division that is empty", async () => {
		renderWith({ staged: [{ status: "M", path: "s.ts" }] })
		await screen.findByText("Staged in this commit")

		expect(screen.queryByText("Not in this commit")).not.toBeInTheDocument()
	})

	// The group heading absorbs the lone section's actions, so nothing is lost by
	// suppressing that section's own heading.
	it("keeps the group action reachable on the heading", async () => {
		renderWith({ staged: [{ status: "M", path: "s.ts" }] })
		await screen.findByText("Staged in this commit")

		expect(
			screen.getByLabelText("Unstage all 1 staged files"),
		).toBeInTheDocument()
	})

	it("stages everything outside the commit from the division heading", async () => {
		renderWith({
			unstaged: [{ status: "M", path: "u.ts" }],
			untracked: [{ status: "?", path: "n.ts" }],
		})
		await screen.findByText("Not in this commit")

		await userEvent.click(
			screen.getByLabelText("Stage all 2 files not in the commit"),
		)

		expect(stageAll).toHaveBeenCalledWith("/repo")
	})
})

// A conflicted repo is a MODE: most other actions will refuse until it is
// resolved, and the only exits are continue / abort / skip.
describe("an operation in progress", () => {
	function inProgress(over: Record<string, unknown> = {}) {
		repoOperation.mockResolvedValue({
			status: "ok",
			data: {
				kind: "Rebase",
				conflicts: ["a.txt", "b.txt"],
				step: [2, 5],
				head_name: "feature",
				can_skip: true,
				...over,
			},
		})
		workingStatus.mockResolvedValue({
			status: "ok",
			data: {
				head: "h",
				staged: [],
				unstaged: [{ status: "M", path: "a.txt" }],
				untracked: [],
			},
		})
		workingFileDiff.mockResolvedValue({ status: "ok", data: "" })
		render(
			<WorkingCopyDetail
				repoPath="/repo"
				onFileDiff={() => {}}
				ignoreWhitespace={false}
				onMutated={vi.fn()}
				onBeginRun={() => "run-1"}
				onOutput={vi.fn()}
			/>,
		)
	}

	it("says what is happening, on which branch, and how far along", async () => {
		inProgress()

		expect(await screen.findByText(/Rebase in progress/)).toHaveTextContent(
			"on feature",
		)
		expect(screen.getByText(/Rebase in progress/)).toHaveTextContent(
			"step 2 of 5",
		)
		expect(screen.getByText(/2 conflicted files/)).toBeInTheDocument()
	})

	it("lists the conflicted files in their own division", async () => {
		inProgress()
		await screen.findByText("Needs resolving")

		expect(screen.getByText("a.txt")).toBeInTheDocument()
		expect(screen.getByText("b.txt")).toBeInTheDocument()
	})

	// The same path is also in the ordinary status output as an unstaged edit;
	// listing it twice would read as two separate problems.
	it("does not also list a conflicted file as an ordinary edit", async () => {
		inProgress()
		await screen.findByText("Needs resolving")

		expect(screen.getAllByText("a.txt")).toHaveLength(1)
	})

	// Continuing with unmerged files just makes git refuse, so the button says so
	// rather than offering a click that cannot work.
	it("will not continue while conflicts remain", async () => {
		inProgress()
		await screen.findByRole("button", { name: "Continue" })

		expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled()
	})

	it("allows continuing once nothing is unmerged", async () => {
		inProgress({ conflicts: [] })
		await screen.findByRole("button", { name: "Continue" })

		expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled()
		expect(screen.getByText(/ready to continue/)).toBeInTheDocument()
	})

	it.each([
		["Continue", "Continue"],
		["Abort", "Abort"],
		["Skip", "Skip"],
	])("runs %s", async (label, action) => {
		inProgress({ conflicts: [] })
		await userEvent.click(await screen.findByRole("button", { name: label }))

		expect(operationAction).toHaveBeenCalledWith(
			"/repo",
			"Rebase",
			action,
			"run-1",
		)
	})

	// A merge is one step, so there is nothing to skip to.
	it("offers no Skip for a merge", async () => {
		inProgress({ kind: "Merge", can_skip: false, conflicts: [] })
		await screen.findByRole("button", { name: "Abort" })

		expect(
			screen.queryByRole("button", { name: "Skip" }),
		).not.toBeInTheDocument()
	})

	// `git add` on an unmerged path IS what "resolved" means to git.
	it("marks a file resolved by staging it", async () => {
		inProgress()
		const row = (await screen.findByText("b.txt")).closest("li") as HTMLElement
		fireEvent.mouseEnter(row)

		await userEvent.click(
			within(row).getByRole("button", { name: /Mark resolved/ }),
		)

		expect(stageFile).toHaveBeenCalledWith("/repo", "b.txt")
	})

	it("shows nothing when the repo is not mid-operation", async () => {
		inProgress({ kind: null, conflicts: [] })
		// Only one section in that division, so it carries no header of its own.
		await screen.findByText("Not in this commit")

		expect(screen.queryByText(/in progress/)).not.toBeInTheDocument()
	})
})
