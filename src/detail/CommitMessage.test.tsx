import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import { CommitMessage } from "./CommitMessage"

const { commitMessage } = vi.hoisted(() => ({ commitMessage: vi.fn() }))

vi.mock("../ipc/bindings", () => ({ commands: { commitMessage } }))

beforeEach(() => {
	resetSettings()
	commitMessage.mockReset()
})

describe("CommitMessage", () => {
	// The reason this component exists: log_commits carries only %s, so the
	// body of a commit message is otherwise invisible in the app.
	it("shows the full body, not just the subject", async () => {
		commitMessage.mockResolvedValue({
			status: "ok",
			data: "the subject\n\nthe body explains why\nacross two lines",
		})

		render(
			<CommitMessage repoPath="/repo" hash="abc123" subject="the subject" />,
		)

		await waitFor(() => {
			expect(screen.getByLabelText("Commit message")).toHaveTextContent(
				"the body explains why",
			)
		})
		expect(commitMessage).toHaveBeenCalledWith("/repo", "abc123")
	})

	// Avoids the panel flashing empty on every selection change.
	it("shows the subject immediately while the full message loads", () => {
		commitMessage.mockReturnValue(new Promise(() => {}))

		render(
			<CommitMessage repoPath="/repo" hash="abc123" subject="known subject" />,
		)

		expect(screen.getByLabelText("Commit message")).toHaveTextContent(
			"known subject",
		)
	})

	// This panel is incidental information, not a requested action, so a
	// failure degrades to the subject rather than shouting.
	it("falls back to the subject when the fetch fails", async () => {
		commitMessage.mockResolvedValue({
			status: "error",
			error: { NonZero: { code: 128, stderr: "bad object" } },
		})

		render(
			<CommitMessage repoPath="/repo" hash="abc123" subject="fallback text" />,
		)

		await waitFor(() => {
			expect(screen.getByLabelText("Commit message")).toHaveTextContent(
				"fallback text",
			)
		})
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
	})

	it("collapses to a header showing the subject line", async () => {
		commitMessage.mockResolvedValue({
			status: "ok",
			data: "subject line\n\nbody",
		})
		render(
			<CommitMessage repoPath="/repo" hash="abc123" subject="subject line" />,
		)
		await waitFor(() =>
			expect(screen.getByLabelText("Commit message")).toBeInTheDocument(),
		)

		await userEvent.click(screen.getByRole("button", { name: /Message/ }))

		expect(screen.queryByLabelText("Commit message")).not.toBeInTheDocument()
		expect(screen.getByText("subject line")).toBeInTheDocument()
	})

	// Its own persisted key — collapsing the commit editor while staging must
	// not also hide messages while browsing history.
	it("does not share collapse state with the commit box", async () => {
		setSetting("commit-box-open", "false")
		commitMessage.mockResolvedValue({ status: "ok", data: "still visible" })

		render(
			<CommitMessage repoPath="/repo" hash="abc123" subject="still visible" />,
		)

		await waitFor(() => {
			expect(screen.getByLabelText("Commit message")).toBeInTheDocument()
		})
	})

	it("ignores a slow response for a previously selected commit", async () => {
		let resolveFirst: (v: unknown) => void = () => {}
		commitMessage
			.mockReturnValueOnce(
				new Promise((res) => {
					resolveFirst = res
				}),
			)
			.mockResolvedValueOnce({ status: "ok", data: "second commit message" })
		const { rerender } = render(
			<CommitMessage repoPath="/repo" hash="first" subject="first" />,
		)

		rerender(<CommitMessage repoPath="/repo" hash="second" subject="second" />)
		await waitFor(() => {
			expect(screen.getByLabelText("Commit message")).toHaveTextContent(
				"second commit message",
			)
		})
		resolveFirst({ status: "ok", data: "STALE first commit message" })

		await waitFor(() => {
			expect(screen.getByLabelText("Commit message")).toHaveTextContent(
				"second commit message",
			)
		})
	})
})
