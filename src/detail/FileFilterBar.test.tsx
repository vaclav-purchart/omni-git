import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { FileFilterBar } from "./FileFilterBar"
import type { FileFilter } from "./fileFilter"

function baseProps(
	overrides: Partial<Parameters<typeof FileFilterBar>[0]> = {},
) {
	return {
		testCount: 3,
		hideTests: false,
		onToggleHideTests: vi.fn(),
		filters: [] as FileFilter[],
		open: false,
		onToggleOpen: vi.fn(),
		...overrides,
	}
}

describe("FileFilterBar — filter icon", () => {
	it("calls onToggleOpen when clicked", async () => {
		const onToggleOpen = vi.fn()
		render(<FileFilterBar {...baseProps({ onToggleOpen })} />)

		await userEvent.click(screen.getByRole("button", { name: "File filters" }))

		expect(onToggleOpen).toHaveBeenCalledTimes(1)
	})

	it("reflects the open prop via aria-expanded", () => {
		const { rerender } = render(
			<FileFilterBar {...baseProps({ open: false })} />,
		)
		const icon = screen.getByRole("button", { name: "File filters" })
		expect(icon).toHaveAttribute("aria-expanded", "false")

		rerender(<FileFilterBar {...baseProps({ open: true })} />)
		expect(icon).toHaveAttribute("aria-expanded", "true")
	})
})

describe("FileFilterBar — active indicator", () => {
	it("only marks the icon active when some filter is enabled", () => {
		const { rerender } = render(
			<FileFilterBar
				{...baseProps({
					filters: [
						{ id: "f1", pattern: "*.log", mode: "hide", enabled: false },
					],
				})}
			/>,
		)
		const icon = screen.getByRole("button", { name: "File filters" })
		expect(icon).not.toHaveClass("is-active")
		expect(document.querySelector(".filter-active-dot")).toBeNull()

		rerender(
			<FileFilterBar
				{...baseProps({
					filters: [
						{ id: "f1", pattern: "*.log", mode: "hide", enabled: true },
					],
				})}
			/>,
		)
		expect(icon).toHaveClass("is-active")
		expect(document.querySelector(".filter-active-dot")).not.toBeNull()
	})
})

describe("FileFilterBar — Hide tests", () => {
	it("shows the Hide tests button when testCount > 0 and calls onToggleHideTests", async () => {
		const onToggleHideTests = vi.fn()
		render(
			<FileFilterBar {...baseProps({ testCount: 2, onToggleHideTests })} />,
		)
		const btn = screen.getByRole("button", { name: "Hide tests (2)" })

		await userEvent.click(btn)

		expect(onToggleHideTests).toHaveBeenCalledTimes(1)
	})

	it("hides the Hide tests button when testCount is 0", () => {
		render(<FileFilterBar {...baseProps({ testCount: 0 })} />)
		expect(screen.queryByText(/hide tests/i)).toBeNull()
	})

	it("labels the button 'Show tests (N)' when hideTests is true", () => {
		render(<FileFilterBar {...baseProps({ testCount: 4, hideTests: true })} />)
		expect(
			screen.getByRole("button", { name: "Show tests (4)" }),
		).toBeInTheDocument()
	})
})
