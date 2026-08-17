import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	getSetting,
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import { ResetDialog } from "./ResetDialog"

vi.mock("../ipc/bindings", () => ({
	commands: { saveSettings: vi.fn().mockResolvedValue({ status: "ok" }) },
}))

beforeEach(() => {
	resetSettings()
})

function renderDialog(
	props: Partial<React.ComponentProps<typeof ResetDialog>> = {},
) {
	const onConfirm = vi.fn()
	const onCancel = vi.fn()
	render(
		<ResetDialog
			open={true}
			commit="abc1234def"
			branch="main"
			onConfirm={onConfirm}
			onCancel={onCancel}
			{...props}
		/>,
	)
	return { onConfirm, onCancel }
}

describe("ResetDialog", () => {
	it("names the branch and the short hash", () => {
		renderDialog()

		expect(screen.getByText(/Reset main to/)).toBeInTheDocument()
		expect(screen.getByText("abc1234")).toBeInTheDocument()
	})

	it("falls back to HEAD with no branch", () => {
		renderDialog({ branch: null })

		expect(screen.getByText(/Reset HEAD to/)).toBeInTheDocument()
	})

	// Mixed is git's default and the common case (dropping a WIP commit but keeping
	// its changes), so it's what a first-time dialog offers.
	it("defaults to Mixed", () => {
		renderDialog()

		expect(screen.getByRole("radio", { name: /Mixed/ })).toBeChecked()
	})

	it("passes the chosen mode", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.click(screen.getByRole("radio", { name: /Soft/ }))
		await userEvent.click(screen.getByRole("button", { name: /^Reset/ }))

		expect(onConfirm).toHaveBeenCalledWith("Soft")
	})

	// Resets come in runs, so the last mode is the likely next one.
	it("remembers the mode for next time", async () => {
		const first = renderDialog()
		await userEvent.click(screen.getByRole("radio", { name: /Hard/ }))
		await userEvent.click(
			screen.getByRole("button", { name: /Reset and discard/ }),
		)
		expect(first.onConfirm).toHaveBeenCalledWith("Hard")

		expect(getSetting("reset-mode")).toBe(JSON.stringify("Hard"))
	})

	it("opens on the remembered mode", () => {
		setSetting("reset-mode", JSON.stringify("Soft"))

		renderDialog()

		expect(screen.getByRole("radio", { name: /Soft/ })).toBeChecked()
	})

	// Cancelling must not change what next time offers.
	it("does not remember a mode that was only selected, not confirmed", async () => {
		const { onCancel } = renderDialog()

		await userEvent.click(screen.getByRole("radio", { name: /Hard/ }))
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }))

		expect(onCancel).toHaveBeenCalled()
		expect(getSetting("reset-mode")).toBeNull()
	})

	describe("hard reset", () => {
		// The one mode that can lose work, so the button says what it does and looks
		// like it.
		it("changes the confirm button for Hard", async () => {
			renderDialog()
			expect(
				screen.queryByRole("button", { name: /Reset and discard/ }),
			).not.toBeInTheDocument()

			await userEvent.click(screen.getByRole("radio", { name: /Hard/ }))

			const button = screen.getByRole("button", { name: /Reset and discard/ })
			expect(button).toHaveClass("confirm-danger")
		})

		it("spells out that changes are lost", () => {
			renderDialog()

			expect(screen.getByText(/Uncommitted work is lost/)).toBeInTheDocument()
		})
	})

	it("cancels on Escape without resetting", async () => {
		const { onCancel, onConfirm } = renderDialog()

		await userEvent.keyboard("{Escape}")

		expect(onCancel).toHaveBeenCalled()
		expect(onConfirm).not.toHaveBeenCalled()
	})

	// Enter confirms: a dialog you can only finish with the mouse is a dead end in
	// the middle of a keyboard flow. Focus opens on the chosen mode, so the arrows
	// pick and Enter runs it.
	it("confirms on Enter", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.keyboard("{Enter}")

		expect(onConfirm).toHaveBeenCalledWith("Mixed")
	})

	// The focused button's own activation is about to fire; handling Enter here
	// too would run both actions.
	it("does not also confirm when Enter lands on Cancel", async () => {
		const { onConfirm, onCancel } = renderDialog()

		await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(onCancel).toHaveBeenCalled()
		expect(onConfirm).not.toHaveBeenCalled()
	})

	it("renders nothing when closed", () => {
		renderDialog({ open: false })

		expect(screen.queryByText(/Reset main to/)).not.toBeInTheDocument()
	})
})
