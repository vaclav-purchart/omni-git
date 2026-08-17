import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { FileFilterPanel } from "./FileFilterPanel"
import type { FileFilter } from "./fileFilter"

function baseProps(
	overrides: Partial<{
		filters: FileFilter[]
		onAddFilter: (pattern: string, mode: FileFilter["mode"]) => void
		onUpdateFilter: (id: string, patch: Partial<Omit<FileFilter, "id">>) => void
		onRemoveFilter: (id: string) => void
		onSetEnabled: (id: string, enabled: boolean) => void
	}> = {},
) {
	return {
		filters: [] as FileFilter[],
		onAddFilter: vi.fn(),
		onUpdateFilter: vi.fn(),
		onRemoveFilter: vi.fn(),
		onSetEnabled: vi.fn(),
		...overrides,
	}
}

function existingFilter(overrides: Partial<FileFilter> = {}): FileFilter {
	return {
		id: "f1",
		pattern: "*.test.*",
		mode: "hide",
		enabled: true,
		...overrides,
	}
}

describe("FileFilterPanel — add row", () => {
	it("adds a filter via the Add button and clears the draft", async () => {
		const onAddFilter = vi.fn()
		render(<FileFilterPanel {...baseProps({ onAddFilter })} />)

		const input = screen.getByPlaceholderText("e.g. *.test.* or dist/**")
		await userEvent.type(input, "*.test.*")
		await userEvent.click(screen.getByRole("button", { name: "Add" }))

		expect(onAddFilter).toHaveBeenCalledWith("*.test.*", "hide")
		expect(input).toHaveValue("")
	})

	it("adds a filter when Enter is pressed in the input", async () => {
		const onAddFilter = vi.fn()
		render(<FileFilterPanel {...baseProps({ onAddFilter })} />)

		const input = screen.getByPlaceholderText("e.g. *.test.* or dist/**")
		await userEvent.type(input, "dist/**{Enter}")

		expect(onAddFilter).toHaveBeenCalledWith("dist/**", "hide")
	})

	it("disables Add when the draft is blank or whitespace", async () => {
		render(<FileFilterPanel {...baseProps()} />)

		const input = screen.getByPlaceholderText("e.g. *.test.* or dist/**")
		const addBtn = screen.getByRole("button", { name: "Add" })
		expect(addBtn).toBeDisabled()

		await userEvent.type(input, "   ")
		expect(addBtn).toBeDisabled()
	})

	it("sends the selected mode along with the pattern", async () => {
		const onAddFilter = vi.fn()
		render(<FileFilterPanel {...baseProps({ onAddFilter })} />)

		const input = screen.getByPlaceholderText("e.g. *.test.* or dist/**")
		await userEvent.type(input, "*.log")
		fireEvent.change(screen.getByDisplayValue("hide"), {
			target: { value: "highlight" },
		})
		await userEvent.click(screen.getByRole("button", { name: "Add" }))

		expect(onAddFilter).toHaveBeenCalledWith("*.log", "highlight")
	})
})

describe("FileFilterPanel — existing filters", () => {
	it("toggles enabled via the checkbox", async () => {
		const onSetEnabled = vi.fn()
		render(
			<FileFilterPanel
				{...baseProps({ filters: [existingFilter()], onSetEnabled })}
			/>,
		)

		await userEvent.click(screen.getByRole("checkbox"))

		expect(onSetEnabled).toHaveBeenCalledWith("f1", false)
	})

	it("updates mode via the row select", async () => {
		const onUpdateFilter = vi.fn()
		render(
			<FileFilterPanel
				{...baseProps({ filters: [existingFilter()], onUpdateFilter })}
			/>,
		)

		const selects = screen.getAllByDisplayValue("hide")
		// selects[0] is the add-row mode select; the row select is the other one.
		const rowSelect = selects.find((el) => el.closest(".filter-row"))
		expect(rowSelect).toBeDefined()
		fireEvent.change(rowSelect as HTMLElement, {
			target: { value: "highlight" },
		})

		expect(onUpdateFilter).toHaveBeenCalledWith("f1", { mode: "highlight" })
	})

	it("removes a filter via the remove button", async () => {
		const onRemoveFilter = vi.fn()
		render(
			<FileFilterPanel
				{...baseProps({ filters: [existingFilter()], onRemoveFilter })}
			/>,
		)

		await userEvent.click(screen.getByRole("button", { name: "Remove filter" }))

		expect(onRemoveFilter).toHaveBeenCalledWith("f1")
	})

	it("shows an empty hint when there are no filters", () => {
		render(<FileFilterPanel {...baseProps({ filters: [] })} />)

		expect(screen.getByText(/no filters yet/i)).toBeInTheDocument()
	})
})
