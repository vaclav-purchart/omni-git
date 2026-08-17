import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	getSetting,
	__resetSettingsForTests as resetSettings,
} from "../settings/settings"
import { MergeDialog } from "./MergeDialog"

vi.mock("../ipc/bindings", () => ({
	commands: { saveSettings: vi.fn().mockResolvedValue({ status: "ok" }) },
}))

beforeEach(() => {
	resetSettings()
})

function renderDialog(
	props: Partial<React.ComponentProps<typeof MergeDialog>> = {},
) {
	const onConfirm = vi.fn()
	const onCancel = vi.fn()
	render(
		<MergeDialog
			open={true}
			current="main"
			branches={["feature", "origin/feature", "release/1.2"]}
			onConfirm={onConfirm}
			onCancel={onCancel}
			{...props}
		/>,
	)
	return { onConfirm, onCancel }
}

/** The picker is a dropdown, not a text field: open it, then choose. */
async function pick(branch: string) {
	await userEvent.click(screen.getByRole("button", { name: /branch…/ }))
	await userEvent.click(screen.getByRole("button", { name: branch }))
}

describe("MergeDialog", () => {
	it("names the branch being merged into", () => {
		renderDialog()

		expect(screen.getByText("main")).toBeInTheDocument()
	})

	it("says so when HEAD is detached", () => {
		renderDialog({ current: null })

		expect(screen.getByText(/the detached HEAD/)).toBeInTheDocument()
	})

	// Git's own default, so it is what the dialog offers first.
	it("defaults to fast-forward when possible", () => {
		renderDialog()

		expect(
			screen.getByRole("radio", { name: /Fast-forward when possible/ }),
		).toBeChecked()
	})

	it("passes the branch and the mode", async () => {
		const { onConfirm } = renderDialog()

		await pick("feature")
		await userEvent.click(
			screen.getByRole("radio", { name: /Always create a merge commit/ }),
		)
		await userEvent.click(screen.getByRole("button", { name: "Merge" }))

		expect(onConfirm).toHaveBeenCalledWith("feature", "Commit")
	})

	it("can squash", async () => {
		const { onConfirm } = renderDialog()

		await pick("feature")
		await userEvent.click(
			screen.getByRole("radio", { name: /Squash, without committing/ }),
		)
		await userEvent.click(screen.getByRole("button", { name: "Merge" }))

		expect(onConfirm).toHaveBeenCalledWith("feature", "Squash")
	})

	// Merging comes in habits; the branch does not, so only the mode is kept.
	it("remembers the mode but never the branch", async () => {
		const { onConfirm } = renderDialog()

		await pick("feature")
		await userEvent.click(
			screen.getByRole("radio", { name: /Squash, without committing/ }),
		)
		await userEvent.click(screen.getByRole("button", { name: "Merge" }))

		expect(onConfirm).toHaveBeenCalled()
		expect(getSetting("merge-mode")).toBe(JSON.stringify("Squash"))
		expect(getSetting("merge-target")).toBeNull()
	})

	// Merging the wrong branch is the mistake this dialog exists to prevent, so
	// it will not run without a real one.
	it("cannot be confirmed without a branch", () => {
		renderDialog()

		expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled()
	})

	it("confirms on Enter once a branch is chosen", async () => {
		const { onConfirm } = renderDialog()

		await pick("feature")
		await userEvent.keyboard("{Enter}")

		expect(onConfirm).toHaveBeenCalledWith("feature", "FastForward")
	})

	it("does nothing on Enter without a branch", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.keyboard("{Enter}")

		expect(onConfirm).not.toHaveBeenCalled()
	})

	it("cancels on Escape", async () => {
		const { onCancel, onConfirm } = renderDialog()

		await userEvent.keyboard("{Escape}")

		expect(onCancel).toHaveBeenCalled()
		expect(onConfirm).not.toHaveBeenCalled()
	})

	it("renders nothing when closed", () => {
		renderDialog({ open: false })

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})
})
