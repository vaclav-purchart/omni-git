import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	getSetting,
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import { CommitBox } from "./CommitBox"

const { commit, headCommitMessage, recentCommitMessages } = vi.hoisted(() => ({
	commit: vi.fn(),
	headCommitMessage: vi.fn(),
	recentCommitMessages: vi.fn(),
}))

vi.mock("../ipc/bindings", () => ({
	commands: { commit, headCommitMessage, recentCommitMessages },
}))

beforeEach(() => {
	resetSettings()
	commit.mockReset()
	headCommitMessage.mockReset()
	recentCommitMessages.mockReset()
})

/** A successful commit as the backend now reports it. */
function committed(
	sha: string,
	output = `[main ${sha}] done\n 1 file changed`,
) {
	return { status: "ok", data: { ok: true, sha, output } }
}

/** A commit git refused — e.g. a hook rejection. Not an `Err`. */
function rejected(output: string) {
	return { status: "ok", data: { ok: false, sha: null, output } }
}

function renderBox(
	props: Partial<React.ComponentProps<typeof CommitBox>> = {},
) {
	const onCommitted = vi.fn()
	const onOutput = vi.fn()
	const onToggleOpen = vi.fn()
	const onBeginRun = vi.fn(() => "run-1")
	const onCommitAndPush = vi.fn()
	render(
		<CommitBox
			repoPath="/repo"
			stagedCount={1}
			canAmend={true}
			open={true}
			onToggleOpen={onToggleOpen}
			onCommitted={onCommitted}
			onBeginRun={onBeginRun}
			onCommitAndPush={onCommitAndPush}
			onOutput={onOutput}
			{...props}
		/>,
	)
	return { onCommitted, onOutput, onToggleOpen, onBeginRun, onCommitAndPush }
}

const commitButton = () => screen.getByRole("button", { name: /^Commit$/ })
const messageBox = () => screen.getByLabelText("Commit message")
const openRecall = () =>
	userEvent.click(screen.getByRole("button", { name: /Recent/ }))

describe("CommitBox", () => {
	it("disables Commit while the message is empty", () => {
		renderBox()

		expect(commitButton()).toBeDisabled()
	})

	it("disables Commit when nothing is staged and we are not amending", async () => {
		renderBox({ stagedCount: 0 })

		await userEvent.type(messageBox(), "a message")

		expect(commitButton()).toBeDisabled()
	})

	it("treats a whitespace-only message as empty", async () => {
		renderBox()

		await userEvent.type(messageBox(), "   ")

		expect(commitButton()).toBeDisabled()
	})

	// Amending is a legitimate no-op-index operation (a pure reword), so an
	// empty index must NOT block it.
	it("enables amending with nothing staged", async () => {
		headCommitMessage.mockResolvedValue({ status: "ok", data: "previous" })
		renderBox({ stagedCount: 0 })

		await userEvent.click(screen.getByLabelText(/Amend last commit/))

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^Amend$/ })).toBeEnabled()
		})
	})

	it("commits the message and reports the new sha", async () => {
		commit.mockResolvedValue(committed("abc1234"))
		const { onCommitted } = renderBox()

		await userEvent.type(messageBox(), "do the thing")
		await userEvent.click(commitButton())

		await waitFor(() => {
			expect(commit).toHaveBeenCalledWith(
				"/repo",
				"do the thing",
				false,
				"run-1",
			)
		})
		expect(onCommitted).toHaveBeenCalledWith("abc1234")
	})

	it("commits on Cmd/Ctrl+Enter from inside the message box", async () => {
		commit.mockResolvedValue(committed("abc1234"))
		renderBox()

		await userEvent.type(messageBox(), "quick commit")
		await userEvent.keyboard("{Control>}{Enter}{/Control}")

		await waitFor(() => {
			expect(commit).toHaveBeenCalledWith(
				"/repo",
				"quick commit",
				false,
				"run-1",
			)
		})
	})

	it("does not commit on Cmd/Ctrl+Enter when the message is empty", async () => {
		renderBox()

		messageBox().focus()
		await userEvent.keyboard("{Control>}{Enter}{/Control}")

		expect(commit).not.toHaveBeenCalled()
	})

	it("prefills from HEAD when amend is ticked and restores the draft when unticked", async () => {
		headCommitMessage.mockResolvedValue({
			status: "ok",
			data: "the previous message",
		})
		renderBox()
		await userEvent.type(messageBox(), "my draft")

		await userEvent.click(screen.getByLabelText(/Amend last commit/))
		await waitFor(() => {
			expect(messageBox()).toHaveValue("the previous message")
		})

		await userEvent.click(screen.getByLabelText(/Amend last commit/))

		await waitFor(() => {
			expect(messageBox()).toHaveValue("my draft")
		})
	})

	it("passes amend=true to the backend when amending", async () => {
		headCommitMessage.mockResolvedValue({ status: "ok", data: "old" })
		commit.mockResolvedValue(committed("abc1234"))
		renderBox()

		await userEvent.click(screen.getByLabelText(/Amend last commit/))
		await waitFor(() => expect(messageBox()).toHaveValue("old"))
		await userEvent.click(screen.getByRole("button", { name: /^Amend$/ }))

		await waitFor(() => {
			expect(commit).toHaveBeenCalledWith("/repo", "old", true, "run-1")
		})
	})

	it("disables the amend checkbox on an unborn branch", () => {
		renderBox({ canAmend: false })

		expect(screen.getByLabelText(/Amend last commit/)).toBeDisabled()
	})

	describe("command output", () => {
		// Output is STREAMED into a workspace-owned panel: the run is opened
		// before the command starts (so a slow hook is visibly working), and the
		// panel finalises itself from the commandDone event. This component must
		// neither render output nor be the thing that resolves it — it is keyed
		// on refreshKey and a commit trips the watcher that remounts it.
		it("opens a streamed run before invoking, with labels for each state", async () => {
			commit.mockResolvedValue(committed("abc1234"))
			const { onBeginRun } = renderBox()

			await userEvent.type(messageBox(), "streamed")
			await userEvent.click(commitButton())

			await waitFor(() => expect(commit).toHaveBeenCalled())
			expect(onBeginRun).toHaveBeenCalledWith({
				running: "Committing…",
				ok: "Committed",
				error: "Commit rejected",
			})
			// The run must be opened BEFORE the command is invoked, or early
			// chunks would arrive with nowhere to go.
			expect(onBeginRun.mock.invocationCallOrder[0]).toBeLessThan(
				commit.mock.invocationCallOrder[0],
			)
			// …and the id it returned is what correlates the stream.
			expect(commit).toHaveBeenCalledWith("/repo", "streamed", false, "run-1")
		})

		it("labels an amend run distinctly", async () => {
			headCommitMessage.mockResolvedValue({ status: "ok", data: "old" })
			commit.mockResolvedValue(committed("abc1234"))
			const { onBeginRun } = renderBox()

			await userEvent.click(screen.getByLabelText(/Amend last commit/))
			await waitFor(() => expect(messageBox()).toHaveValue("old"))
			await userEvent.click(screen.getByRole("button", { name: /^Amend$/ }))

			await waitFor(() => {
				expect(onBeginRun).toHaveBeenCalledWith({
					running: "Amending…",
					ok: "Amended",
					error: "Amend rejected",
				})
			})
		})

		// A rejection needs no report from here: the stream already showed why,
		// and commandDone marks the panel failed.
		it("does not re-report a hook rejection it already streamed", async () => {
			commit.mockResolvedValue(
				rejected("yarn: command not found\nhusky - pre-commit hook exited (1)"),
			)
			const { onOutput, onCommitted } = renderBox()

			await userEvent.type(messageBox(), "will be blocked")
			await userEvent.click(commitButton())

			await waitFor(() => expect(commit).toHaveBeenCalled())
			expect(onOutput).not.toHaveBeenCalled()
			expect(onCommitted).not.toHaveBeenCalled()
			expect(screen.queryByRole("alert")).not.toBeInTheDocument()
		})

		// So the user can fix the hook and retry without retyping.
		it("keeps the draft when the commit is rejected", async () => {
			commit.mockResolvedValue(rejected("nothing to commit"))
			renderBox()

			await userEvent.type(messageBox(), "keep me")
			await userEvent.click(commitButton())

			await waitFor(() => expect(commit).toHaveBeenCalled())
			expect(messageBox()).toHaveValue("keep me")
			expect(getSetting("commit-draft:/repo")).toBe('"keep me"')
		})

		it("does not re-report a successful commit it already streamed", async () => {
			commit.mockResolvedValue(committed("abc1234", "[main abc1234] hello"))
			const { onOutput, onCommitted } = renderBox()

			await userEvent.type(messageBox(), "hello")
			await userEvent.click(commitButton())

			await waitFor(() => expect(onCommitted).toHaveBeenCalledWith("abc1234"))
			expect(onOutput).not.toHaveBeenCalled()
		})

		// The one case with no stream to finalise it: git never ran, so no
		// commandDone event will arrive and the panel must be told directly.
		it("reports a spawn-level failure, which never streamed", async () => {
			commit.mockResolvedValue({
				status: "error",
				error: {
					NonZero: { code: 128, stderr: "fatal: not a git repository" },
				},
			})
			const { onOutput, onCommitted } = renderBox()

			await userEvent.type(messageBox(), "doomed")
			await userEvent.click(commitButton())

			await waitFor(() => {
				expect(onOutput).toHaveBeenCalledWith({
					title: "Could not run git commit",
					output: "fatal: not a git repository",
					status: "error",
				})
			})
			expect(onCommitted).not.toHaveBeenCalled()
		})
	})

	// The draft is persisted so a watcher-driven remount can't eat it; the flip
	// side is that a SUCCESSFUL commit must clear it, or the next commit starts
	// pre-filled with the message just used.
	it("clears the persisted draft only after a successful commit", async () => {
		commit.mockResolvedValue(committed("abc1234"))
		renderBox()

		await userEvent.type(messageBox(), "persisted")
		expect(getSetting("commit-draft:/repo")).toBe('"persisted"')

		await userEvent.click(commitButton())

		await waitFor(() => {
			expect(getSetting("commit-draft:/repo")).toBe('""')
		})
		expect(messageBox()).toHaveValue("")
	})

	it("restores a persisted draft on mount", () => {
		setSetting("commit-draft:/repo", '"survived a remount"')

		renderBox()

		expect(messageBox()).toHaveValue("survived a remount")
	})

	it("keeps drafts separate per repo", () => {
		setSetting("commit-draft:/other", '"other repo draft"')

		renderBox()

		expect(messageBox()).toHaveValue("")
	})

	describe("recent-message recall", () => {
		it("fills the box from the inline recall list", async () => {
			recentCommitMessages.mockResolvedValue({
				status: "ok",
				data: ["fix: the thing", "wip"],
			})
			renderBox()

			await openRecall()
			await userEvent.click(
				await screen.findByRole("button", { name: /fix: the thing/ }),
			)

			expect(messageBox()).toHaveValue("fix: the thing")
			expect(recentCommitMessages).toHaveBeenCalledWith("/repo", 50)
		})

		it("filters the list as you search", async () => {
			recentCommitMessages.mockResolvedValue({
				status: "ok",
				data: ["fix: parser crash", "feat: add filters", "chore: bump deps"],
			})
			renderBox()
			await openRecall()

			await userEvent.type(
				await screen.findByLabelText("Search recent commit messages"),
				"filt",
			)

			expect(
				screen.getByRole("button", { name: /feat: add filters/ }),
			).toBeInTheDocument()
			expect(
				screen.queryByRole("button", { name: /parser crash/ }),
			).not.toBeInTheDocument()
		})

		// The search covers bodies too, not just subjects — that's where the
		// detail worth finding usually lives.
		it("searches the body as well as the subject", async () => {
			recentCommitMessages.mockResolvedValue({
				status: "ok",
				data: ["subject\n\nmentions kerberos in the body"],
			})
			renderBox()
			await openRecall()

			await userEvent.type(
				await screen.findByLabelText("Search recent commit messages"),
				"kerberos",
			)

			expect(
				screen.getByRole("button", { name: /subject/ }),
			).toBeInTheDocument()
		})

		it("reports when nothing matches the search", async () => {
			recentCommitMessages.mockResolvedValue({ status: "ok", data: ["wip"] })
			renderBox()
			await openRecall()

			await userEvent.type(
				await screen.findByLabelText("Search recent commit messages"),
				"zzz",
			)

			expect(screen.getByText("No matching messages.")).toBeInTheDocument()
		})

		it("picks a message with the arrow keys and Enter", async () => {
			recentCommitMessages.mockResolvedValue({
				status: "ok",
				data: ["first", "second", "third"],
			})
			renderBox()
			await openRecall()
			await screen.findByLabelText("Search recent commit messages")

			await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}")

			expect(messageBox()).toHaveValue("third")
		})

		it("closes on Escape without changing the message", async () => {
			recentCommitMessages.mockResolvedValue({ status: "ok", data: ["wip"] })
			renderBox()
			await userEvent.type(messageBox(), "typing")
			await openRecall()
			await screen.findByLabelText("Search recent commit messages")

			await userEvent.keyboard("{Escape}")

			expect(
				screen.queryByLabelText("Search recent commit messages"),
			).not.toBeInTheDocument()
			expect(messageBox()).toHaveValue("typing")
		})

		// Picking a message inserts the FULL text, so a body must be signposted.
		it("flags messages that carry a body", async () => {
			recentCommitMessages.mockResolvedValue({
				status: "ok",
				data: ["with body\n\nthe body", "no body"],
			})
			renderBox()

			await openRecall()

			expect(await screen.findByText("+body")).toBeInTheDocument()
			await userEvent.click(screen.getByRole("button", { name: /with body/ }))
			expect(messageBox()).toHaveValue("with body\n\nthe body")
		})

		it("reports an empty history", async () => {
			recentCommitMessages.mockResolvedValue({ status: "ok", data: [] })
			renderBox()

			await openRecall()

			expect(await screen.findByText("No recent messages.")).toBeInTheDocument()
		})
	})

	it("collapses to a header showing the pending draft's first line", () => {
		setSetting("commit-draft:/repo", '"subject line\\nbody"')

		renderBox({ open: false })

		expect(screen.getByText("subject line")).toBeInTheDocument()
		expect(screen.queryByLabelText("Commit message")).not.toBeInTheDocument()
	})

	describe("commit and push", () => {
		it("commits, then pushes", async () => {
			commit.mockResolvedValue(committed("abc1234"))
			const { onCommitted, onCommitAndPush } = renderBox()

			await userEvent.type(messageBox(), "ship it")
			await userEvent.click(
				screen.getByRole("button", { name: /Commit & push/ }),
			)

			await waitFor(() => expect(onCommitAndPush).toHaveBeenCalled())
			// Order matters: pushing before the commit landed would push the
			// PREVIOUS state, which is not what the button says.
			expect(onCommitted.mock.invocationCallOrder[0]).toBeLessThan(
				onCommitAndPush.mock.invocationCallOrder[0],
			)
		})

		// The whole point of the guard: a rejected commit must not push anything.
		it("does not push when the commit is rejected", async () => {
			commit.mockResolvedValue(rejected("pre-commit hook failed"))
			const { onCommitAndPush } = renderBox()

			await userEvent.type(messageBox(), "will fail")
			await userEvent.click(
				screen.getByRole("button", { name: /Commit & push/ }),
			)

			await waitFor(() => expect(commit).toHaveBeenCalled())
			expect(onCommitAndPush).not.toHaveBeenCalled()
		})

		it("plain Commit does not push", async () => {
			commit.mockResolvedValue(committed("abc1234"))
			const { onCommitAndPush, onCommitted } = renderBox()

			await userEvent.type(messageBox(), "just commit")
			await userEvent.click(commitButton())

			await waitFor(() => expect(onCommitted).toHaveBeenCalled())
			expect(onCommitAndPush).not.toHaveBeenCalled()
		})

		// No remote to push to means the button shouldn't be offered at all.
		it("omits the button when there is nothing to push to", () => {
			renderBox({ onCommitAndPush: undefined })

			expect(
				screen.queryByRole("button", { name: /Commit & push/ }),
			).not.toBeInTheDocument()
		})
	})
})

// A shortcut nobody can discover is a shortcut nobody uses — and this one is not
// visible anywhere on the box itself.
describe("CommitBox shortcut hint", () => {
	it("names the shortcut on the commit button", async () => {
		renderBox()
		await userEvent.type(
			screen.getByRole("textbox", { name: "Commit message" }),
			"fix: thing",
		)

		expect(screen.getByRole("button", { name: /^Commit$/ })).toHaveAttribute(
			"title",
			expect.stringMatching(/⌘Enter|Ctrl\+Enter/),
		)
	})

	// The shortcut only commits while the textarea has focus; from elsewhere in
	// the panel the same keys jump TO the box. The tooltip has to say which.
	it("says where the shortcut applies", async () => {
		renderBox()

		expect(screen.getByRole("button", { name: /^Commit$/ }).title).toContain(
			"from the message box",
		)
	})

	it("reads as Amend once amending", async () => {
		renderBox({ canAmend: true })
		await userEvent.click(
			await screen.findByRole("checkbox", { name: /Amend last commit/ }),
		)

		expect(screen.getByRole("button", { name: /^Amend$/ }).title).toMatch(
			/^Amend \(/,
		)
	})
})
