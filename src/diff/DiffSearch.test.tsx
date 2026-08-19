import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DiffSearch } from "./DiffSearch"

function props(over: Partial<Parameters<typeof DiffSearch>[0]> = {}) {
	return {
		query: "",
		onQueryChange: vi.fn(),
		matchCount: 0,
		currentMatch: 0,
		onPrev: vi.fn(),
		onNext: vi.fn(),
		onClose: vi.fn(),
		...over,
	}
}

describe("DiffSearch", () => {
	// Opened by ⌘F or the header's magnifier, so the caret must already be in the
	// field — anything else means typing the first character somewhere else.
	it("focuses the input on open", () => {
		render(<DiffSearch {...props()} />)

		expect(screen.getByLabelText("Search the diff")).toHaveFocus()
	})

	// The input is controlled by the caller, so each keystroke reports the value it
	// would produce from the CURRENT query rather than an accumulated one.
	it("reports each keystroke", async () => {
		const onQueryChange = vi.fn()
		render(<DiffSearch {...props({ query: "fo", onQueryChange })} />)

		await userEvent.type(screen.getByLabelText("Search the diff"), "o")

		expect(onQueryChange).toHaveBeenCalledWith("foo")
	})

	it("shows the position and the total", () => {
		render(
			<DiffSearch
				{...props({ query: "foo", matchCount: 17, currentMatch: 3 })}
			/>,
		)

		expect(screen.getByText("3 of 17")).toBeInTheDocument()
	})

	// Silence would read as "search is broken" rather than "this file has none".
	it("says so when a query matches nothing", () => {
		render(<DiffSearch {...props({ query: "zzz", matchCount: 0 })} />)

		expect(screen.getByText("no matches")).toBeInTheDocument()
	})

	// Nothing typed yet is not the same as nothing found.
	it("shows no count before anything is typed", () => {
		render(<DiffSearch {...props()} />)

		expect(screen.queryByText("no matches")).not.toBeInTheDocument()
	})

	// Past the collection cap the number stops being exact, and saying "5000"
	// would be a lie.
	it("marks the count as partial once the cap is hit", () => {
		render(
			<DiffSearch
				{...props({ query: "x", matchCount: 5000, currentMatch: 1 })}
			/>,
		)

		expect(screen.getByText("1 of 5000+")).toBeInTheDocument()
	})

	it("steps through matches with the nav buttons", async () => {
		const onNext = vi.fn()
		const onPrev = vi.fn()
		render(
			<DiffSearch
				{...props({ query: "foo", matchCount: 3, onNext, onPrev })}
			/>,
		)
		const user = userEvent.setup()

		await user.click(screen.getByLabelText("Next match"))
		await user.click(screen.getByLabelText("Previous match"))

		expect(onNext).toHaveBeenCalled()
		expect(onPrev).toHaveBeenCalled()
	})

	it("disables the nav buttons with nothing to step through", () => {
		render(<DiffSearch {...props({ query: "zzz", matchCount: 0 })} />)

		expect(screen.getByLabelText("Next match")).toBeDisabled()
		expect(screen.getByLabelText("Previous match")).toBeDisabled()
	})

	// Enter is the reflex for "next" while the caret is still in the field.
	it("steps with Enter and Shift+Enter", async () => {
		const onNext = vi.fn()
		const onPrev = vi.fn()
		render(
			<DiffSearch
				{...props({ query: "foo", matchCount: 3, onNext, onPrev })}
			/>,
		)
		const user = userEvent.setup()

		await user.keyboard("{Enter}")
		expect(onNext).toHaveBeenCalledTimes(1)

		await user.keyboard("{Shift>}{Enter}{/Shift}")
		expect(onPrev).toHaveBeenCalledTimes(1)
	})

	it("closes on Escape and on the close button", async () => {
		const onClose = vi.fn()
		render(<DiffSearch {...props({ query: "foo", onClose })} />)
		const user = userEvent.setup()

		await user.keyboard("{Escape}")
		expect(onClose).toHaveBeenCalledTimes(1)

		await user.click(screen.getByLabelText("Close search"))
		expect(onClose).toHaveBeenCalledTimes(2)
	})

	// The diff panel's own Backspace/arrow handlers must not fire while the user is
	// typing a query into it.
	it("keeps its keystrokes to itself", async () => {
		const onKeyDown = vi.fn()
		render(
			<div onKeyDown={onKeyDown}>
				<DiffSearch {...props({ query: "foo", matchCount: 1 })} />
			</div>,
		)

		await userEvent.setup().keyboard("{Backspace}")

		expect(onKeyDown).not.toHaveBeenCalled()
	})
})
