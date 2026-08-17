import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	getSetting,
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import { CherryPickDialog } from "./CherryPickDialog"

vi.mock("../ipc/bindings", () => ({
	commands: { saveSettings: vi.fn().mockResolvedValue({ status: "ok" }) },
}))

beforeEach(() => {
	resetSettings()
})

function renderDialog(
	props: Partial<React.ComponentProps<typeof CherryPickDialog>> = {},
) {
	const onConfirm = vi.fn()
	const onCancel = vi.fn()
	render(
		<CherryPickDialog
			open={true}
			commits={["aaaaaaa111", "bbbbbbb222", "ccccccc333"]}
			branch="main"
			onConfirm={onConfirm}
			onCancel={onCancel}
			{...props}
		/>,
	)
	return { onConfirm, onCancel }
}

describe("CherryPickDialog", () => {
	it("names the count and the branch they land on", () => {
		renderDialog()

		expect(screen.getByText(/Cherry-pick 3 commits/)).toBeInTheDocument()
		expect(screen.getByText("main")).toBeInTheDocument()
	})

	it("names the single commit's hash", () => {
		renderDialog({ commits: ["abc1234def"] })

		expect(screen.getByText("abc1234")).toBeInTheDocument()
	})

	it("says so when HEAD is detached", () => {
		renderDialog({ branch: null })

		expect(screen.getByText(/the detached HEAD/)).toBeInTheDocument()
	})

	// The list is the ORDER git will apply them in, which is the reverse of the
	// order the log showed. Listing them newest-first would misrepresent the run.
	it("lists the commits oldest first", () => {
		renderDialog()

		const shown = screen.getAllByText(/^[a-c]{7}$/).map((el) => el.textContent)
		expect(shown).toEqual(["ccccccc", "bbbbbbb", "aaaaaaa"])
	})

	it("does not list a single commit twice", () => {
		renderDialog({ commits: ["abc1234def"] })

		expect(screen.getAllByText("abc1234")).toHaveLength(1)
	})

	// Committing each pick is what "cherry-pick" means without flags, so it's the
	// default the first time.
	it("defaults to committing each pick", () => {
		renderDialog()

		expect(screen.getByRole("radio", { name: /Commit each one/ })).toBeChecked()
	})

	it("passes the chosen mode", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.click(
			screen.getByRole("radio", { name: /Apply without committing/ }),
		)
		await userEvent.click(screen.getByRole("button", { name: /^Cherry-pick/ }))

		expect(onConfirm).toHaveBeenCalledWith("stage")
	})

	// Picking is something people do in runs, so the last choice is the likely
	// next one.
	it("remembers the mode for next time", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.click(
			screen.getByRole("radio", { name: /Apply without committing/ }),
		)
		await userEvent.click(screen.getByRole("button", { name: /^Cherry-pick/ }))

		expect(onConfirm).toHaveBeenCalledWith("stage")
		expect(getSetting("cherry-pick-mode")).toBe(JSON.stringify("stage"))
	})

	it("opens on the remembered mode", () => {
		setSetting("cherry-pick-mode", JSON.stringify("stage"))

		renderDialog()

		expect(
			screen.getByRole("radio", { name: /Apply without committing/ }),
		).toBeChecked()
	})

	it("does not remember a mode that was only selected, not confirmed", async () => {
		const { onCancel } = renderDialog()

		await userEvent.click(
			screen.getByRole("radio", { name: /Apply without committing/ }),
		)
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }))

		expect(onCancel).toHaveBeenCalled()
		expect(getSetting("cherry-pick-mode")).toBeNull()
	})

	it("cancels on Escape without picking", async () => {
		const { onCancel, onConfirm } = renderDialog()

		await userEvent.keyboard("{Escape}")

		expect(onCancel).toHaveBeenCalled()
		expect(onConfirm).not.toHaveBeenCalled()
	})

	// This writes to the branch and opens with a mode already selected, so a stray
	// Enter must not run it.
	it("does not confirm on Enter", async () => {
		const { onConfirm } = renderDialog()

		await userEvent.keyboard("{Enter}")

		expect(onConfirm).not.toHaveBeenCalled()
	})

	it("renders nothing when closed", () => {
		renderDialog({ open: false })

		expect(screen.queryByText(/Cherry-pick/)).not.toBeInTheDocument()
	})
})
