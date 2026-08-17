import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ConfirmDialog } from "./ConfirmDialog"

function renderDialog(
	props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {},
) {
	const onConfirm = vi.fn()
	const onCancel = vi.fn()
	render(
		<ConfirmDialog
			open={true}
			message="Discard changes to a.txt?"
			confirmLabel="Discard"
			onConfirm={onConfirm}
			onCancel={onCancel}
			{...props}
		/>,
	)
	return { onConfirm, onCancel }
}

describe("ConfirmDialog", () => {
	it("shows the message and the confirm label", () => {
		renderDialog()

		expect(screen.getByText("Discard changes to a.txt?")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /Discard/ })).toBeInTheDocument()
	})

	// The whole point of the keyboard fix: a confirmation you can only finish with
	// the mouse is a dead end in the middle of a keyboard flow.
	it("confirms on Enter", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.keyboard("{Enter}")

		expect(onConfirm).toHaveBeenCalled()
	})

	it("cancels on Escape", async () => {
		const { onCancel, onConfirm } = renderDialog()

		await userEvent.keyboard("{Escape}")

		expect(onCancel).toHaveBeenCalled()
		expect(onConfirm).not.toHaveBeenCalled()
	})

	// Focus has to sit on the button Enter will press, or the focus ring lies
	// about what the keyboard is going to do.
	it("opens with the confirm button focused", () => {
		renderDialog()

		expect(screen.getByRole("button", { name: /Discard/ })).toHaveFocus()
	})

	// Tab moves to Cancel, and then Enter means Cancel — because that is what
	// focus means.
	it("cancels when Enter lands on a focused Cancel", async () => {
		const { onCancel, onConfirm } = renderDialog()

		// Shift+Tab: Cancel comes BEFORE the confirm button in the DOM, so plain
		// Tab from the focused confirm leaves the dialog rather than reaching it.
		await userEvent.tab({ shift: true })
		expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
		await userEvent.keyboard("{Enter}")

		expect(onCancel).toHaveBeenCalled()
		expect(onConfirm).not.toHaveBeenCalled()
	})

	it("cancels on a click outside", async () => {
		const { onCancel } = renderDialog()

		await userEvent.click(document.querySelector(".confirm-overlay") as Element)

		expect(onCancel).toHaveBeenCalled()
	})

	it("renders nothing when closed", () => {
		renderDialog({ open: false })

		expect(
			screen.queryByText("Discard changes to a.txt?"),
		).not.toBeInTheDocument()
	})
})
