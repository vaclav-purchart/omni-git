import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { BranchPicker } from "./BranchPicker"

const options = [
	"main",
	"develop",
	"feature/alpha",
	"feature/beta",
	"origin/main",
]

describe("BranchPicker", () => {
	it("opens, filters, and selects", async () => {
		const onChange = vi.fn()
		render(<BranchPicker value="main" options={options} onChange={onChange} />)
		await userEvent.click(screen.getByRole("button", { name: /main/ }))
		const search = screen.getByPlaceholderText(/filter/i)
		await userEvent.type(search, "beta")
		// only the matching option is listed
		expect(screen.getByText("feature/beta")).toBeInTheDocument()
		expect(screen.queryByText("develop")).not.toBeInTheDocument()
		await userEvent.click(screen.getByText("feature/beta"))
		expect(onChange).toHaveBeenCalledWith("feature/beta")
	})

	it("closes on Escape", async () => {
		render(<BranchPicker value="main" options={options} onChange={vi.fn()} />)
		await userEvent.click(screen.getByRole("button", { name: /main/ }))
		expect(screen.getByPlaceholderText(/filter/i)).toBeInTheDocument()
		await userEvent.keyboard("{Escape}")
		expect(screen.queryByPlaceholderText(/filter/i)).not.toBeInTheDocument()
	})
})
