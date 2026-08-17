import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	getSetting,
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import { HelpOverlay } from "./HelpOverlay"

vi.mock("../ipc/bindings", () => ({
	commands: { saveSettings: vi.fn().mockResolvedValue({ status: "ok" }) },
}))

beforeEach(() => {
	resetSettings()
})

function renderHelp() {
	const onClose = vi.fn()
	render(<HelpOverlay onClose={onClose} />)
	return { onClose }
}

const search = () => screen.getByLabelText("Search shortcuts and settings")

describe("HelpOverlay", () => {
	it("focuses the search box and lists shortcuts grouped by context", () => {
		renderHelp()

		expect(search()).toHaveFocus()
		expect(screen.getByText("Global")).toBeInTheDocument()
		expect(screen.getByText("Refresh the repository")).toBeInTheDocument()
	})

	it("filters as you type", async () => {
		renderHelp()

		await userEvent.type(search(), "palette")

		expect(screen.getByText("Open the command palette")).toBeInTheDocument()
		expect(screen.queryByText("Refresh the repository")).not.toBeInTheDocument()
	})

	it("says so when nothing matches", async () => {
		renderHelp()

		await userEvent.type(search(), "zzzzz")

		expect(screen.getByText(/No shortcuts match/)).toBeInTheDocument()
	})

	it("closes on Escape, claiming the key", () => {
		const { onClose } = renderHelp()

		const e = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		})
		search().dispatchEvent(e)

		expect(onClose).toHaveBeenCalled()
		expect(e.defaultPrevented).toBe(true)
	})

	it("closes via the button and the backdrop", async () => {
		const { onClose } = renderHelp()

		await userEvent.click(screen.getByLabelText("Close help"))
		expect(onClose).toHaveBeenCalledTimes(1)

		await userEvent.click(document.querySelector(".help-backdrop") as Element)
		expect(onClose).toHaveBeenCalledTimes(2)
	})

	it("stays open when the panel itself is clicked", async () => {
		const { onClose } = renderHelp()

		await userEvent.click(document.querySelector(".help") as Element)

		expect(onClose).not.toHaveBeenCalled()
	})

	describe("terminal command setting", () => {
		it("shows the stored command", () => {
			setSetting("terminal-command", JSON.stringify("ghostty {dir}"))

			renderHelp()

			expect(screen.getByLabelText(/Terminal command/)).toHaveValue(
				"ghostty {dir}",
			)
		})

		it("persists what you type", async () => {
			renderHelp()

			await userEvent.type(screen.getByLabelText(/Terminal command/), "kitty")

			expect(getSetting("terminal-command")).toBe(JSON.stringify("kitty"))
		})

		it("starts empty when nothing is stored", () => {
			renderHelp()

			expect(screen.getByLabelText(/Terminal command/)).toHaveValue("")
		})

		// The value is persisted, so a hand-edited or older payload must not crash.
		it("tolerates a corrupt stored value", () => {
			setSetting("terminal-command", "{not json")

			renderHelp()

			expect(screen.getByLabelText(/Terminal command/)).toHaveValue("")
		})
	})
})
