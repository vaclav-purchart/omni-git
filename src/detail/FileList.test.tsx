import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FileChange } from "../ipc/bindings"
import {
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "../settings/settings"
import { FileList, type FileListProps, type FileSection } from "./FileList"
import type { FileFilter } from "./fileFilter"

const FILTERS_KEY = "file-filters"

function seedFilters(filters: FileFilter[]) {
	setSetting(FILTERS_KEY, JSON.stringify(filters))
}

function hideFilter(pattern: string): FileFilter {
	return { id: "f1", pattern, mode: "hide", enabled: true }
}

function highlightFilter(pattern: string): FileFilter {
	return { id: "f2", pattern, mode: "highlight", enabled: true }
}

const stagedFile: FileChange = { status: "M", path: "src/a.ts" }
const stagedTestFile: FileChange = { status: "A", path: "src/a.test.ts" }
const untrackedFile: FileChange = { status: "A", path: "src/c.ts" }

function baseSections(): FileSection[] {
	return [
		{ key: "staged", label: "Staged", files: [stagedFile, stagedTestFile] },
		{ key: "untracked", files: [untrackedFile] },
	]
}

// FileList is controlled (activeKey/onOpen are props), so keyboard-nav tests
// need a small stateful wrapper that actually applies onOpen's result back
// into activeKey, the way a real parent would.
function Harness(
	props: Omit<FileListProps, "activeKey" | "onOpen"> & {
		onOpen?: FileListProps["onOpen"]
		initialActiveKey?: FileListProps["activeKey"]
	},
) {
	const { onOpen, initialActiveKey, ...rest } = props
	const [activeKey, setActiveKey] = useState<FileListProps["activeKey"]>(
		initialActiveKey ?? null,
	)
	return (
		<FileList
			{...rest}
			activeKey={activeKey}
			onOpen={(section, path) => {
				setActiveKey({ section, path })
				onOpen?.(section, path)
			}}
		/>
	)
}

beforeEach(() => {
	resetSettings()
})

describe("FileList — sections and rows", () => {
	it("renders rows per section, showing a header+count only for labeled sections", () => {
		render(
			<FileList
				ariaLabel="Changed files"
				sections={baseSections()}
				activeKey={null}
				onOpen={vi.fn()}
			/>,
		)

		expect(screen.getByText("a.ts")).toBeInTheDocument()
		expect(screen.getByText("a.test.ts")).toBeInTheDocument()
		expect(screen.getByText("c.ts")).toBeInTheDocument()

		expect(screen.getByText("Staged")).toBeInTheDocument()
		const count = screen
			.getAllByText("2")
			.find((el) => el.className.includes("wc-section-count"))
		expect(count).toBeInTheDocument()

		// The untracked section has no `label`, so it gets no header at all.
		expect(document.querySelectorAll(".wc-section-header")).toHaveLength(1)
	})

	it("calls onOpen with the section key and path when a row is clicked", async () => {
		const onOpen = vi.fn()
		render(
			<FileList
				ariaLabel="Changed files"
				sections={baseSections()}
				activeKey={null}
				onOpen={onOpen}
			/>,
		)

		await userEvent.click(screen.getByText("c.ts"))

		expect(onOpen).toHaveBeenCalledWith("untracked", "src/c.ts")
	})

	it("renders no header for a labeled section with zero visible files, but keeps one that has files", () => {
		render(
			<FileList
				ariaLabel="Changed files"
				sections={[
					{ key: "staged", label: "Staged", files: [stagedFile] },
					{ key: "empty", label: "Empty", files: [] },
				]}
				activeKey={null}
				onOpen={vi.fn()}
			/>,
		)

		expect(screen.getByText("Staged")).toBeInTheDocument()
		expect(screen.queryByText("Empty")).toBeNull()
		expect(document.querySelectorAll(".wc-section-header")).toHaveLength(1)
	})

	it("renders both rows when the same path appears in two sections, and routes clicks to the right section", async () => {
		const onOpen = vi.fn()
		const sharedPath = "src/shared.ts"
		render(
			<FileList
				ariaLabel="Changed files"
				sections={[
					{
						key: "staged",
						label: "Staged",
						files: [{ status: "M", path: sharedPath }],
					},
					{
						key: "unstaged",
						label: "Unstaged",
						files: [{ status: "M", path: sharedPath }],
					},
				]}
				activeKey={null}
				onOpen={onOpen}
			/>,
		)

		const rows = screen.getAllByText("shared.ts")
		expect(rows).toHaveLength(2)

		await userEvent.click(rows[0])
		expect(onOpen).toHaveBeenLastCalledWith("staged", sharedPath)

		await userEvent.click(rows[1])
		expect(onOpen).toHaveBeenLastCalledWith("unstaged", sharedPath)
	})
})

describe("FileList — hide filter", () => {
	it("removes matching rows and skips them in ArrowDown nav", async () => {
		seedFilters([hideFilter("*.test.*")])
		const onOpen = vi.fn()
		render(
			<Harness
				ariaLabel="Changed files"
				sections={baseSections()}
				onOpen={onOpen}
			/>,
		)

		expect(screen.queryByText("a.test.ts")).toBeNull()
		expect(screen.getByText("a.ts")).toBeInTheDocument()

		const list = screen.getByRole("listbox")
		fireEvent.keyDown(list, { key: "ArrowDown" })
		expect(onOpen).toHaveBeenLastCalledWith("staged", "src/a.ts")

		fireEvent.keyDown(list, { key: "ArrowDown" })
		// The hidden test file is skipped; nav goes straight to the untracked section.
		expect(onOpen).toHaveBeenLastCalledWith("untracked", "src/c.ts")
	})

	it("shows the 'All files filtered out.' hint when a hide filter removes everything", () => {
		seedFilters([hideFilter("*")])
		render(
			<FileList
				ariaLabel="Changed files"
				sections={baseSections()}
				activeKey={null}
				onOpen={vi.fn()}
			/>,
		)

		expect(screen.getByText("All files filtered out.")).toBeInTheDocument()
		// Header + filter bar stay visible so the user can adjust the filter.
		expect(
			screen.getByRole("button", { name: "File filters" }),
		).toBeInTheDocument()
	})
})

describe("FileList — highlight filter", () => {
	it("adds is-highlight to matching, still-visible rows", () => {
		seedFilters([highlightFilter("a.ts")])
		render(
			<FileList
				ariaLabel="Changed files"
				sections={baseSections()}
				activeKey={null}
				onOpen={vi.fn()}
			/>,
		)

		const row = screen.getByText("a.ts").closest("button")
		expect(row).toHaveClass("is-highlight")
		const otherRow = screen.getByText("c.ts").closest("button")
		expect(otherRow).not.toHaveClass("is-highlight")
	})
})

describe("FileList — renderRowActions", () => {
	it("renders row actions and a stopPropagation click on them does not call onOpen", async () => {
		const onOpen = vi.fn()
		const onAction = vi.fn()
		render(
			<FileList
				ariaLabel="Changed files"
				sections={baseSections()}
				activeKey={null}
				onOpen={onOpen}
				renderRowActions={(file) => (
					<button
						type="button"
						aria-label={`action-${file.path}`}
						onClick={(e) => {
							e.stopPropagation()
							onAction(file.path)
						}}
					>
						Stage
					</button>
				)}
			/>,
		)

		await userEvent.click(
			screen.getByRole("button", { name: "action-src/a.ts" }),
		)

		expect(onAction).toHaveBeenCalledWith("src/a.ts")
		expect(onOpen).not.toHaveBeenCalled()
	})
})

describe("FileList — filter panel", () => {
	it("shows the full-width panel row when the filter icon is clicked", async () => {
		render(
			<FileList
				ariaLabel="Changed files"
				sections={baseSections()}
				activeKey={null}
				onOpen={vi.fn()}
			/>,
		)

		expect(screen.queryByRole("group", { name: "File filters" })).toBeNull()

		await userEvent.click(screen.getByRole("button", { name: "File filters" }))

		const panel = screen.getByRole("group", { name: "File filters" })
		expect(panel).toBeInTheDocument()
		expect(panel).toHaveClass("filter-panel")
	})

	it("closes the panel on Escape", async () => {
		render(
			<FileList
				ariaLabel="Changed files"
				sections={baseSections()}
				activeKey={null}
				onOpen={vi.fn()}
			/>,
		)

		await userEvent.click(screen.getByRole("button", { name: "File filters" }))
		expect(
			screen.getByRole("group", { name: "File filters" }),
		).toBeInTheDocument()

		fireEvent.keyDown(document, { key: "Escape" })

		expect(screen.queryByRole("group", { name: "File filters" })).toBeNull()
	})

	it("closes the panel on an outside click", async () => {
		render(
			<FileList
				ariaLabel="Changed files"
				sections={baseSections()}
				activeKey={null}
				onOpen={vi.fn()}
			/>,
		)

		await userEvent.click(screen.getByRole("button", { name: "File filters" }))
		expect(
			screen.getByRole("group", { name: "File filters" }),
		).toBeInTheDocument()

		await userEvent.click(screen.getByText("a.ts"))

		expect(screen.queryByRole("group", { name: "File filters" })).toBeNull()
	})

	it("stays open when clicking inside the panel", async () => {
		render(
			<FileList
				ariaLabel="Changed files"
				sections={baseSections()}
				activeKey={null}
				onOpen={vi.fn()}
			/>,
		)

		await userEvent.click(screen.getByRole("button", { name: "File filters" }))
		const input = screen.getByPlaceholderText("e.g. *.test.* or dist/**")
		await userEvent.click(input)

		expect(
			screen.getByRole("group", { name: "File filters" }),
		).toBeInTheDocument()
	})
})

describe("FileList — keyboard nav", () => {
	it("moves onOpen across sections with ArrowDown/ArrowUp and clamps at the ends", () => {
		const onOpen = vi.fn()
		render(
			<Harness
				ariaLabel="Changed files"
				sections={baseSections()}
				onOpen={onOpen}
			/>,
		)

		const list = screen.getByRole("listbox")
		fireEvent.keyDown(list, { key: "ArrowDown" })
		expect(onOpen).toHaveBeenLastCalledWith("staged", "src/a.ts")

		fireEvent.keyDown(list, { key: "ArrowDown" })
		expect(onOpen).toHaveBeenLastCalledWith("staged", "src/a.test.ts")

		fireEvent.keyDown(list, { key: "ArrowDown" })
		expect(onOpen).toHaveBeenLastCalledWith("untracked", "src/c.ts")

		// Already at the last row — ArrowDown clamps instead of going out of bounds.
		fireEvent.keyDown(list, { key: "ArrowDown" })
		expect(onOpen).toHaveBeenLastCalledWith("untracked", "src/c.ts")

		fireEvent.keyDown(list, { key: "ArrowUp" })
		expect(onOpen).toHaveBeenLastCalledWith("staged", "src/a.test.ts")

		fireEvent.keyDown(list, { key: "ArrowUp" })
		fireEvent.keyDown(list, { key: "ArrowUp" })
		expect(onOpen).toHaveBeenLastCalledWith("staged", "src/a.ts")

		// Already at the first row — ArrowUp clamps.
		fireEvent.keyDown(list, { key: "ArrowUp" })
		expect(onOpen).toHaveBeenLastCalledWith("staged", "src/a.ts")
	})

	it("calls onAdvance on Enter and onRetreat on Backspace", () => {
		const onAdvance = vi.fn()
		const onRetreat = vi.fn()
		render(
			<FileList
				ariaLabel="Changed files"
				sections={baseSections()}
				activeKey={null}
				onOpen={vi.fn()}
				onAdvance={onAdvance}
				onRetreat={onRetreat}
			/>,
		)

		const list = screen.getByRole("listbox")
		fireEvent.keyDown(list, { key: "Enter" })
		expect(onAdvance).toHaveBeenCalledTimes(1)
		expect(onRetreat).not.toHaveBeenCalled()

		fireEvent.keyDown(list, { key: "Backspace" })
		expect(onRetreat).toHaveBeenCalledTimes(1)
		expect(onAdvance).toHaveBeenCalledTimes(1)
	})
})

describe("FileList row hover", () => {
	function files(paths: string[]): FileChange[] {
		return paths.map((path) => ({ status: "M", path }))
	}

	function rowFor(path: string): HTMLElement {
		return screen.getByText(path).closest("li") as HTMLElement
	}

	function props(paths: string[]): FileListProps {
		return {
			ariaLabel: "Changes",
			sections: [{ key: "Unstaged", label: "Unstaged", files: files(paths) }],
			activeKey: null,
			onOpen: vi.fn(),
		}
	}

	it("marks the row the pointer is over", async () => {
		render(<FileList {...props(["a.ts", "b.ts"])} />)

		fireEvent.mouseEnter(rowFor("a.ts"))

		expect(rowFor("a.ts")).toHaveClass("is-hovered")
		expect(rowFor("b.ts")).not.toHaveClass("is-hovered")
	})

	it("unmarks it when the pointer leaves", () => {
		render(<FileList {...props(["a.ts"])} />)
		fireEvent.mouseEnter(rowFor("a.ts"))

		fireEvent.mouseLeave(rowFor("a.ts"))

		expect(rowFor("a.ts")).not.toHaveClass("is-hovered")
	})

	// THE bug this guards: staging a file removes its row, everything below shifts
	// up under a stationary cursor, and the browser does not re-evaluate :hover (or
	// fire mouseenter) until the mouse moves — so the actions stayed on whichever
	// node had been hovered, visibly the wrong file.
	it("clears hover when the rows change underneath it", () => {
		const { rerender } = render(
			<FileList {...props(["a.ts", "b.ts", "c.ts"])} />,
		)
		fireEvent.mouseEnter(rowFor("b.ts"))
		expect(rowFor("b.ts")).toHaveClass("is-hovered")

		// "a.ts" was staged: it leaves the section and the rest shift up.
		rerender(<FileList {...props(["b.ts", "c.ts"])} />)

		expect(rowFor("b.ts")).not.toHaveClass("is-hovered")
		expect(rowFor("c.ts")).not.toHaveClass("is-hovered")
	})

	// A re-render that doesn't change the rows shouldn't drop the hover.
	it("keeps hover when the rows are unchanged", () => {
		const { rerender } = render(<FileList {...props(["a.ts", "b.ts"])} />)
		fireEvent.mouseEnter(rowFor("a.ts"))

		rerender(<FileList {...props(["a.ts", "b.ts"])} />)

		expect(rowFor("a.ts")).toHaveClass("is-hovered")
	})
})

// Home/End and Cmd/Ctrl+Arrow jump to the ends of the list, as they do in a text
// field. The file list had neither before.
describe("jumping to the ends", () => {
	function renderList(onOpen = vi.fn()) {
		render(
			<FileList
				ariaLabel="Files"
				sections={[
					{
						key: "s",
						label: "Section",
						files: [
							{ status: "M", path: "first.ts" },
							{ status: "M", path: "middle.ts" },
							{ status: "M", path: "last.ts" },
						],
					},
				]}
				activeKey={{ section: "s", path: "middle.ts" }}
				onOpen={onOpen}
			/>,
		)
		return { onOpen, list: screen.getByRole("listbox", { name: "Files" }) }
	}

	it.each([
		["Home", {}, "first.ts"],
		["End", {}, "last.ts"],
		["ArrowUp", { metaKey: true }, "first.ts"],
		["ArrowDown", { metaKey: true }, "last.ts"],
		["ArrowUp", { ctrlKey: true }, "first.ts"],
		["ArrowDown", { ctrlKey: true }, "last.ts"],
	])("%s%o opens %s", (key, mods, expected) => {
		const { onOpen, list } = renderList()

		fireEvent.keyDown(list, { key, ...mods })

		expect(onOpen).toHaveBeenCalledWith("s", expected)
	})

	// Without the modifier the arrows still move by one, not to the end.
	it("keeps the plain arrows moving one row", () => {
		const { onOpen, list } = renderList()

		fireEvent.keyDown(list, { key: "ArrowDown" })

		expect(onOpen).toHaveBeenCalledWith("s", "last.ts")
		fireEvent.keyDown(list, { key: "ArrowUp" })
		expect(onOpen).toHaveBeenLastCalledWith("s", "first.ts")
	})
})

describe("select all", () => {
	function renderList(
		props: Partial<React.ComponentProps<typeof FileList>> = {},
	) {
		const onSelectRange = vi.fn()
		render(
			<FileList
				ariaLabel="Files"
				sections={[
					{
						key: "a",
						label: "First",
						files: [
							{ status: "M", path: "one.ts" },
							{ status: "M", path: "two.test.ts" },
						],
					},
					{
						key: "b",
						label: "Second",
						files: [{ status: "?", path: "three.ts" }],
					},
				]}
				activeKey={null}
				onOpen={vi.fn()}
				onSelectRange={onSelectRange}
				{...props}
			/>,
		)
		return {
			onSelectRange,
			list: screen.getByRole("listbox", { name: "Files" }),
		}
	}

	it.each([["metaKey"], ["ctrlKey"]])("selects every row with %s+A", (mod) => {
		const { onSelectRange, list } = renderList()

		fireEvent.keyDown(list, { code: "KeyA", key: "a", [mod]: true })

		expect(onSelectRange).toHaveBeenCalledWith([
			{ section: "a", path: "one.ts" },
			{ section: "a", path: "two.test.ts" },
			{ section: "b", path: "three.ts" },
		])
	})

	// "All" means all of what you can see. A row hidden by a filter is not
	// something the user is choosing to act on.
	it("skips rows the filters have hidden", () => {
		seedFilters([hideFilter("three*")])
		const { onSelectRange, list } = renderList()

		fireEvent.keyDown(list, { code: "KeyA", metaKey: true })

		expect(onSelectRange).toHaveBeenCalledWith([
			{ section: "a", path: "one.ts" },
			{ section: "a", path: "two.test.ts" },
		])
	})

	// A plain "a" is not a shortcut, and Alt+Cmd+A is something else again.
	it("needs the modifier, and only that modifier", () => {
		const { onSelectRange, list } = renderList()

		fireEvent.keyDown(list, { code: "KeyA", key: "a" })
		fireEvent.keyDown(list, { code: "KeyA", metaKey: true, altKey: true })

		expect(onSelectRange).not.toHaveBeenCalled()
	})

	// The read-only lists (a commit, a comparison) pass no range handler, so the
	// key has to fall through rather than swallow the browser's own select-all.
	it("does nothing in a list that has no multi-selection", () => {
		const { list } = renderList({ onSelectRange: undefined })

		const event = new KeyboardEvent("keydown", {
			code: "KeyA",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		})
		list.dispatchEvent(event)

		expect(event.defaultPrevented).toBe(false)
	})
})
