import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ContextMenu, type MenuItem } from "./ContextMenu"

const items: MenuItem[] = [
	{ type: "item", label: "Copy" },
	{ type: "separator" },
	{ type: "item", label: "Rename", disabled: true },
	{ type: "item", label: "Squash", wip: true },
	{ type: "item", label: "Delete", danger: true },
]

describe("ContextMenu", () => {
	it("renders items and separators", () => {
		render(
			<ContextMenu
				items={items}
				position={{ x: 10, y: 20 }}
				onClose={vi.fn()}
			/>,
		)
		expect(screen.getByRole("menu")).toBeInTheDocument()
		expect(screen.getAllByRole("menuitem")).toHaveLength(4)
		expect(screen.getByText("Copy")).toBeInTheDocument()
		expect(screen.getByText("Rename")).toBeInTheDocument()
		expect(screen.getByText("Squash")).toBeInTheDocument()
		expect(screen.getByText("Delete")).toBeInTheDocument()
		expect(document.querySelector(".context-menu-sep")).toBeInTheDocument()
	})

	it("renders at the given position", () => {
		render(
			<ContextMenu
				items={items}
				position={{ x: 42, y: 84 }}
				onClose={vi.fn()}
			/>,
		)
		const menu = screen.getByRole("menu")
		expect(menu).toHaveStyle({ left: "42px", top: "84px" })
	})

	it("fires onClick then onClose when an enabled item is clicked", async () => {
		const onClick = vi.fn()
		const onClose = vi.fn()
		render(
			<ContextMenu
				items={[{ type: "item", label: "Copy", onClick }]}
				position={{ x: 0, y: 0 }}
				onClose={onClose}
			/>,
		)
		await userEvent.click(screen.getByRole("menuitem", { name: "Copy" }))
		expect(onClick).toHaveBeenCalledTimes(1)
		expect(onClose).toHaveBeenCalledTimes(1)
		expect(onClick.mock.invocationCallOrder[0]).toBeLessThan(
			onClose.mock.invocationCallOrder[0],
		)
	})

	it("does not fire onClick for a disabled item", async () => {
		const onClick = vi.fn()
		const onClose = vi.fn()
		render(
			<ContextMenu
				items={[{ type: "item", label: "Rename", disabled: true, onClick }]}
				position={{ x: 0, y: 0 }}
				onClose={onClose}
			/>,
		)
		const button = screen.getByRole("menuitem", { name: "Rename" })
		expect(button).toBeDisabled()
		await userEvent.click(button)
		expect(onClick).not.toHaveBeenCalled()
		expect(onClose).not.toHaveBeenCalled()
	})

	it("does not fire onClick for a wip item and shows the wrench + title", async () => {
		const onClick = vi.fn()
		const onClose = vi.fn()
		render(
			<ContextMenu
				items={[{ type: "item", label: "Squash", wip: true, onClick }]}
				position={{ x: 0, y: 0 }}
				onClose={onClose}
			/>,
		)
		const button = screen.getByRole("menuitem", { name: /Squash/ })
		expect(button).toBeDisabled()
		expect(button).toHaveAttribute("title", "Not yet implemented")
		expect(button.querySelector(".context-menu-wip")).toBeInTheDocument()
		await userEvent.click(button)
		expect(onClick).not.toHaveBeenCalled()
		expect(onClose).not.toHaveBeenCalled()
	})

	it("applies is-danger to danger items", () => {
		render(
			<ContextMenu
				items={[{ type: "item", label: "Delete", danger: true }]}
				position={{ x: 0, y: 0 }}
				onClose={vi.fn()}
			/>,
		)
		expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveClass(
			"is-danger",
		)
	})

	it("calls onClose on Escape", () => {
		const onClose = vi.fn()
		render(
			<ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />,
		)
		fireEvent.keyDown(document, { key: "Escape" })
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it("calls onClose on an outside mousedown", () => {
		const onClose = vi.fn()
		render(
			<ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />,
		)
		fireEvent.mouseDown(document.body)
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it("does not call onClose on a mousedown inside the menu", () => {
		const onClose = vi.fn()
		render(
			<ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />,
		)
		fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Copy" }))
		expect(onClose).not.toHaveBeenCalled()
	})

	it("calls onClose on window blur, scroll, and resize", () => {
		const onClose = vi.fn()
		render(
			<ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />,
		)
		fireEvent(window, new Event("blur"))
		fireEvent(window, new Event("scroll"))
		fireEvent(window, new Event("resize"))
		expect(onClose).toHaveBeenCalledTimes(3)
	})

	it("renders separators with role separator", () => {
		render(
			<ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
		)
		expect(screen.getByRole("separator")).toBeInTheDocument()
	})

	it("focuses the first enabled item on open", () => {
		render(
			<ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
		)
		expect(document.activeElement).toBe(
			screen.getByRole("menuitem", { name: "Copy" }),
		)
	})

	it("ArrowDown moves focus to the next enabled item, skipping disabled/wip items and separators", () => {
		render(
			<ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
		)
		const menu = screen.getByRole("menu")
		expect(document.activeElement).toBe(
			screen.getByRole("menuitem", { name: "Copy" }),
		)
		fireEvent.keyDown(menu, { key: "ArrowDown" })
		expect(document.activeElement).toBe(
			screen.getByRole("menuitem", { name: "Delete" }),
		)
	})

	it("ArrowUp from the first enabled item wraps to the last enabled item", () => {
		render(
			<ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={vi.fn()} />,
		)
		const menu = screen.getByRole("menu")
		expect(document.activeElement).toBe(
			screen.getByRole("menuitem", { name: "Copy" }),
		)
		fireEvent.keyDown(menu, { key: "ArrowUp" })
		expect(document.activeElement).toBe(
			screen.getByRole("menuitem", { name: "Delete" }),
		)
	})

	it("fires onClick then onClose when Enter is pressed on a focused enabled item", async () => {
		const user = userEvent.setup()
		const onClick = vi.fn()
		const onClose = vi.fn()
		render(
			<ContextMenu
				items={[{ type: "item", label: "Copy", onClick }]}
				position={{ x: 0, y: 0 }}
				onClose={onClose}
			/>,
		)
		const button = screen.getByRole("menuitem", { name: "Copy" })
		expect(document.activeElement).toBe(button)
		await user.keyboard("{Enter}")
		expect(onClick).toHaveBeenCalledTimes(1)
		expect(onClose).toHaveBeenCalledTimes(1)
		expect(onClick.mock.invocationCallOrder[0]).toBeLessThan(
			onClose.mock.invocationCallOrder[0],
		)
	})
})

// A menu has exactly ONE active item, and it has to look like it whether the
// pointer or the arrow keys put it there — otherwise the highlight can sit on one
// row while Enter fires another.
describe("hover and focus", () => {
	function renderMenu(extra: MenuItem[] = []) {
		render(
			<ContextMenu
				items={[...items, ...extra]}
				position={{ x: 0, y: 0 }}
				onClose={vi.fn()}
			/>,
		)
	}

	it("focuses the item under the pointer", () => {
		renderMenu()
		const target = screen.getByRole("menuitem", { name: "Delete" })

		fireEvent.mouseEnter(target)

		expect(target).toHaveFocus()
	})

	// Otherwise the pointer would highlight one item while the arrow keys walked
	// from wherever focus happened to be left.
	it("hands the arrow keys over from wherever the pointer left off", () => {
		renderMenu()
		fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Delete" }))

		fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" })

		// Rename and Squash are disabled, so up from Delete lands on Copy.
		expect(screen.getByRole("menuitem", { name: "Copy" })).toHaveFocus()
	})

	// The first enabled item is focused on open, so a right-click menu looks live
	// straight away rather than waiting for a keypress.
	it("focuses the first enabled item on open", () => {
		renderMenu()

		expect(screen.getByRole("menuitem", { name: "Copy" })).toHaveFocus()
	})
})

describe("shortcut hints", () => {
	it("shows the keys next to the item", () => {
		render(
			<ContextMenu
				items={[{ type: "item", label: "Copy Path", shortcut: "⌘⇧C" }]}
				position={{ x: 0, y: 0 }}
				onClose={vi.fn()}
			/>,
		)

		expect(
			screen.getByRole("menuitem", { name: /Copy Path/ }),
		).toHaveTextContent("⌘⇧C")
	})

	it("renders nothing extra for an item without one", () => {
		render(
			<ContextMenu
				items={[{ type: "item", label: "Copy Path" }]}
				position={{ x: 0, y: 0 }}
				onClose={vi.fn()}
			/>,
		)

		expect(
			document.querySelector(".context-menu-shortcut"),
		).not.toBeInTheDocument()
	})
})

// A portal's events propagate through the REACT tree, not the DOM one, so the
// panel that opened the menu still sees them unless the menu stops them.
describe("keyboard ownership", () => {
	function renderInsidePanel() {
		const onPanelKeyDown = vi.fn()
		render(
			// Stands in for the commit railway / file list, which own these keys for
			// navigation.
			<div onKeyDown={onPanelKeyDown}>
				<ContextMenu
					items={items}
					position={{ x: 0, y: 0 }}
					onClose={vi.fn()}
				/>
			</div>,
		)
		return { onPanelKeyDown, menu: screen.getByRole("menu") }
	}

	it.each(["ArrowDown", "ArrowUp", "Enter", "Home", "End", "Backspace"])(
		"keeps %s from reaching the panel behind it",
		(key) => {
			const { onPanelKeyDown, menu } = renderInsidePanel()

			fireEvent.keyDown(menu, { key })

			expect(onPanelKeyDown).not.toHaveBeenCalled()
		},
	)

	// Escape is handled by a document-level listener, which sits above this
	// portal — stopping it here would leave the menu unclosable by keyboard.
	it("lets Escape through", () => {
		const onClose = vi.fn()
		render(
			<ContextMenu items={items} position={{ x: 0, y: 0 }} onClose={onClose} />,
		)

		fireEvent.keyDown(document, { key: "Escape" })

		expect(onClose).toHaveBeenCalled()
	})

	it("still moves through the menu with the arrows", () => {
		const { menu } = renderInsidePanel()

		fireEvent.keyDown(menu, { key: "ArrowDown" })

		// Rename and Squash are disabled, so down from Copy lands on Delete.
		expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus()
	})
})
