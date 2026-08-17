import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RepoLauncher } from "./RepoLauncher"

const repos = [
	{ id: "1", name: "configurator", path: "/code/configurator" },
	{ id: "2", name: "omni-git", path: "/code/omni-git" },
]

const add = vi.fn().mockResolvedValue({ status: "ok", data: repos[0] })
const remove = vi.fn().mockResolvedValue({ status: "ok", data: null })

vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(),
}))

vi.mock("../repos/useRepos", () => ({
	useRepos: () => ({
		repos,
		loading: false,
		add,
		remove,
		reload: vi.fn(),
	}),
}))

afterEach(() => {
	vi.clearAllMocks()
})

describe("RepoLauncher", () => {
	it("auto-focuses the search box on mount", () => {
		render(<RepoLauncher onOpen={vi.fn()} />)
		expect(screen.getByPlaceholderText(/search/i)).toHaveFocus()
	})

	it("opens the first filtered result on Enter", async () => {
		const onOpen = vi.fn()
		render(<RepoLauncher onOpen={onOpen} />)
		await userEvent.keyboard("omni")
		await userEvent.keyboard("{Enter}")
		expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }))
	})

	it("clears the query but keeps focus on Escape", async () => {
		render(<RepoLauncher onOpen={vi.fn()} />)
		const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement
		await userEvent.keyboard("omni")
		expect(input.value).toBe("omni")
		await userEvent.keyboard("{Escape}")
		expect(input.value).toBe("")
		expect(input).toHaveFocus()
	})

	it("shows an inline error when adding a non-git folder fails", async () => {
		vi.mocked(openDialog).mockResolvedValueOnce("/code/not-a-repo")
		add.mockResolvedValueOnce({
			status: "error",
			error: { kind: "NotAGitRepo" },
		})
		render(<RepoLauncher onOpen={vi.fn()} />)
		await userEvent.click(
			screen.getByRole("button", { name: /add repository/i }),
		)
		expect(
			await screen.findByText(/that folder is not a git repository/i),
		).toBeInTheDocument()
	})
})
