import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { RewordDialog } from "./RewordDialog"

function renderDialog(
	props: Partial<React.ComponentProps<typeof RewordDialog>> = {},
) {
	const onConfirm = vi.fn()
	const onCancel = vi.fn()
	render(
		<RewordDialog
			open={true}
			commit="abc1234def5678"
			original="fix: the thing"
			isHead={true}
			loading={false}
			onConfirm={onConfirm}
			onCancel={onCancel}
			{...props}
		/>,
	)
	return { onConfirm, onCancel }
}

function messageBox() {
	return screen.getByRole("textbox", { name: /message/i })
}

describe("RewordDialog", () => {
	it("names the short hash and prefills the current message", () => {
		renderDialog()

		expect(screen.getByText("abc1234")).toBeInTheDocument()
		expect(messageBox()).toHaveValue("fix: the thing")
	})

	it("passes the edited message", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.clear(messageBox())
		await userEvent.type(messageBox(), "fix: the other thing")
		await userEvent.click(screen.getByRole("button", { name: /^Reword/ }))

		expect(onConfirm).toHaveBeenCalledWith("fix: the other thing")
	})

	// Rewording an older commit rebuilds everything after it, and that consequence
	// only surfaces much later when a push is rejected — so it has to be said here.
	describe("when the commit is not HEAD", () => {
		it("warns that later commits are rebuilt", () => {
			renderDialog({ isHead: false })

			expect(screen.getByText(/rebuilds every commit after it/)).toBeVisible()
			expect(screen.getByText(/already pushed/)).toBeVisible()
		})

		it("says so on the confirm button too", () => {
			renderDialog({ isHead: false })

			expect(
				screen.getByRole("button", { name: "Reword and rebuild" }),
			).toBeInTheDocument()
		})
	})

	it("does not warn when rewording HEAD, which only amends", () => {
		renderDialog({ isHead: true })

		expect(screen.queryByText(/rebuilds every commit/)).not.toBeInTheDocument()
	})

	// An unchanged message would rewrite every descendant's hash for no reason.
	it("cannot be confirmed while the message is unchanged", () => {
		renderDialog()

		expect(screen.getByRole("button", { name: /^Reword/ })).toBeDisabled()
	})

	it("cannot be confirmed with an empty message", async () => {
		renderDialog()

		await userEvent.clear(messageBox())

		expect(screen.getByRole("button", { name: /^Reword/ })).toBeDisabled()
	})

	// Whitespace-only edits are not edits; git would also reject the result.
	it("treats a whitespace-only change as unchanged", async () => {
		renderDialog()

		await userEvent.type(messageBox(), "   ")

		expect(screen.getByRole("button", { name: /^Reword/ })).toBeDisabled()
	})

	it("trims the message it passes on", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.clear(messageBox())
		await userEvent.type(messageBox(), "  fix: trimmed  ")
		await userEvent.click(screen.getByRole("button", { name: /^Reword/ }))

		expect(onConfirm).toHaveBeenCalledWith("fix: trimmed")
	})

	// The body has to survive: the railway only carries the subject, so a dialog
	// that dropped the body would silently delete it on every reword.
	it("keeps a multi-line message intact", async () => {
		const original = "subject line\n\nA body paragraph.\n\nRefs: #12"
		const { onConfirm } = renderDialog({ original })

		await userEvent.type(messageBox(), "!")
		await userEvent.click(screen.getByRole("button", { name: /^Reword/ }))

		expect(onConfirm).toHaveBeenCalledWith(`${original}!`)
	})

	describe("while the message is still loading", () => {
		// An empty box would look like a commit with no message, and confirming it
		// would apply that.
		it("disables the box and the confirm", () => {
			renderDialog({ loading: true, original: null })

			expect(messageBox()).toBeDisabled()
			expect(screen.getByRole("button", { name: /^Reword/ })).toBeDisabled()
		})
	})

	it("cancels on Escape without rewording", async () => {
		const { onCancel, onConfirm } = renderDialog()

		await userEvent.keyboard("{Escape}")

		expect(onCancel).toHaveBeenCalled()
		expect(onConfirm).not.toHaveBeenCalled()
	})

	// Enter has to insert a newline — this is a multi-line message — so the
	// keyboard confirm is the same Cmd/Ctrl+Enter the commit box uses.
	it("does not confirm on a bare Enter", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.type(messageBox(), "{Enter}more")

		expect(onConfirm).not.toHaveBeenCalled()
		expect(messageBox()).toHaveValue("fix: the thing\nmore")
	})

	it("confirms on Ctrl+Enter", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.type(messageBox(), "!")
		await userEvent.keyboard("{Control>}{Enter}{/Control}")

		expect(onConfirm).toHaveBeenCalledWith("fix: the thing!")
	})

	it("renders nothing when closed", () => {
		renderDialog({ open: false })

		expect(screen.queryByText("abc1234")).not.toBeInTheDocument()
	})
})
