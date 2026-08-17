import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandOutput } from "./CommandOutput"

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

function renderOutput(result: Parameters<typeof CommandOutput>[0]["result"]) {
	const onClose = vi.fn()
	render(<CommandOutput result={result} onClose={onClose} />)
	return { onClose }
}

describe("CommandOutput", () => {
	it("shows the command's output verbatim", () => {
		renderOutput({
			title: "Commit rejected",
			output: "yarn: command not found\nhusky - pre-commit hook exited (1)",
			status: "error",
		})

		expect(screen.getByLabelText("Command output")).toHaveTextContent(
			"yarn: command not found",
		)
		expect(screen.getByText("Commit rejected")).toBeInTheDocument()
	})

	// Output stays until the user is done with it — no timer. It used to close
	// itself on success, which meant results vanished while being read.
	it.each([["error"], ["ok"], ["running"]] as const)(
		"never closes itself (%s)",
		(status) => {
			const { onClose } = renderOutput({
				title: "Committed",
				output: "some output",
				status,
			})

			act(() => {
				vi.advanceTimersByTime(10 * 60_000)
			})

			expect(onClose).not.toHaveBeenCalled()
		},
	)

	it("closes on Escape", () => {
		const { onClose } = renderOutput({
			title: "Commit rejected",
			output: "hook failed",
			status: "error",
		})

		fireEvent.keyDown(document.body, { key: "Escape" })

		expect(onClose).toHaveBeenCalled()
	})

	// Escape must close the innermost thing: a recall list, context menu or
	// confirm dialog claims the key via preventDefault, and this panel stands
	// down so one press doesn't dismiss two layers.
	it("ignores an Escape already handled by something nearer", () => {
		const { onClose } = renderOutput({
			title: "Commit rejected",
			output: "hook failed",
			status: "error",
		})

		const e = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		})
		e.preventDefault()
		document.body.dispatchEvent(e)

		expect(onClose).not.toHaveBeenCalled()
	})

	it("closes when dismissed", () => {
		const { onClose } = renderOutput({
			title: "Commit rejected",
			output: "hook failed",
			status: "error",
		})

		fireEvent.click(screen.getByLabelText("Close output"))

		expect(onClose).toHaveBeenCalled()
	})

	// `git commit` on a hook that printed nothing would otherwise show a blank
	// panel, which reads as a UI bug.
	it("explains an empty failure rather than showing nothing", () => {
		renderOutput({ title: "Commit rejected", output: "", status: "error" })

		expect(screen.getByLabelText("Command output")).toHaveTextContent(
			"failed without producing any output",
		)
	})

	// Success used to look identical to running — muted grey on the panel
	// background — so the only difference was the wording. Each state now carries
	// its own class, which drives the colour.
	it.each([
		["running", "is-running"],
		["ok", "is-ok"],
		["error", "is-error"],
	] as const)("marks %s output distinctly", (status, className) => {
		const { container } = render(
			<CommandOutput
				result={{ title: "t", output: "o", status }}
				onClose={vi.fn()}
			/>,
		)

		expect(container.querySelector(".cmdout")).toHaveClass(className)
	})
})
