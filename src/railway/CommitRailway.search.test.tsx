import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef, useImperativeHandle, useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const commits = ["alpha", "beta", "gamma", "delta"].map((subject, i) => ({
	hash: `H${i + 1}`,
	parents: i === 0 ? [] : [`H${i}`],
	author_name: "A",
	author_email: "a@x",
	timestamp_ms: 0,
	refs: [],
	subject,
}))

const { scrollIntoView } = vi.hoisted(() => ({ scrollIntoView: vi.fn() }))

vi.mock("../workspace/useCommits", () => ({
	useCommits: () => ({
		commits,
		loadMore: vi.fn(),
		reload: vi.fn(),
		reachedEnd: true,
		error: null,
	}),
}))
vi.mock("../ipc/bindings", () => ({
	commands: {
		workingStatus: vi.fn().mockResolvedValue({
			status: "ok",
			data: { head: null, staged: [], unstaged: [], untracked: [] },
		}),
	},
}))
// Unlike the other railway mocks this one FORWARDS the ref, because the scrolling
// is the thing under test.
vi.mock("react-virtuoso", () => ({
	Virtuoso: forwardRef(function MockVirtuoso(
		_props: unknown,
		ref: React.Ref<{ scrollIntoView: (opts: unknown) => void }>,
	) {
		useImperativeHandle(ref, () => ({ scrollIntoView }))
		return null
	}),
}))

import { CommitRailway } from "./CommitRailway"

/** Mirrors the workspace: the parent owns the selection the railway reports. */
function Harness({ onSelect }: { onSelect?: (hash: string) => void }) {
	const [selectedHash, setSelectedHash] = useState<string | null>(null)
	return (
		<CommitRailway
			repoPath="/r"
			all={true}
			selectedHash={selectedHash}
			selectHash={null}
			onSelect={(c) => {
				setSelectedHash(c.hash)
				onSelect?.(c.hash)
			}}
			onSelectHashConsumed={vi.fn()}
		/>
	)
}

function searchBox() {
	return screen.getByPlaceholderText("Search message or hash…")
}

beforeEach(() => {
	scrollIntoView.mockClear()
})

describe("railway search scrolling", () => {
	// A match that stays off-screen is a match you have to go and find yourself.
	it("scrolls the first match into view", async () => {
		render(<Harness />)

		await userEvent.type(searchBox(), "gamma")

		expect(scrollIntoView).toHaveBeenCalledWith({ index: 2, align: "center" })
	})

	it("selects the first match", async () => {
		const onSelect = vi.fn()
		render(<Harness onSelect={onSelect} />)

		await userEvent.type(searchBox(), "delta")

		expect(onSelect).toHaveBeenCalledWith("H4")
	})

	// Every keystroke restarts at the top of the results: refining a query should
	// not leave you reading the fourth hit from the previous one.
	it("restarts from the first match as the query changes", async () => {
		const onSelect = vi.fn()
		render(<Harness onSelect={onSelect} />)

		// "a" matches every subject; the first is alpha.
		await userEvent.type(searchBox(), "a")
		expect(onSelect).toHaveBeenLastCalledWith("H1")

		// "am" narrows it to gamma, which becomes the new first match.
		await userEvent.type(searchBox(), "m")
		expect(onSelect).toHaveBeenLastCalledWith("H3")
	})

	// The thing that makes a search feel like it is fighting you: a row already
	// under your eyes being yanked back to the centre on every keystroke.
	it("does not scroll again when the first match is unchanged", async () => {
		render(<Harness />)
		await userEvent.type(searchBox(), "gam")
		expect(scrollIntoView).toHaveBeenCalledTimes(1)

		// Still gamma — nothing has moved, so nothing should scroll.
		await userEvent.type(searchBox(), "ma")

		expect(scrollIntoView).toHaveBeenCalledTimes(1)
	})

	it("scrolls again once a different commit becomes the first match", async () => {
		render(<Harness />)
		await userEvent.type(searchBox(), "gamma")
		expect(scrollIntoView).toHaveBeenCalledTimes(1)

		await userEvent.clear(searchBox())
		await userEvent.type(searchBox(), "delta")

		expect(scrollIntoView).toHaveBeenLastCalledWith({
			index: 3,
			align: "center",
		})
	})

	// REGRESSION: the effect had `onSelect` in its dependency array, and the
	// workspace passes a new inline function every render — so it re-ran on every
	// render and dragged the selection back to the first match. With a search
	// active, no other commit could be selected at all.
	it("lets another commit be selected while a search is active", async () => {
		const onSelect = vi.fn()
		render(<Harness onSelect={onSelect} />)
		await userEvent.type(searchBox(), "a")
		expect(onSelect).toHaveBeenLastCalledWith("H1")

		// Move off the match, the way clicking another row would.
		fireEvent.keyDown(screen.getByRole("listbox", { name: "Commits" }), {
			key: "ArrowDown",
		})

		expect(onSelect).toHaveBeenLastCalledWith("H2")
	})

	it("does not drag the view back to the match either", async () => {
		render(<Harness />)
		await userEvent.type(searchBox(), "gamma")
		scrollIntoView.mockClear()

		fireEvent.keyDown(screen.getByRole("listbox", { name: "Commits" }), {
			key: "ArrowDown",
		})

		// The one scroll here is the arrow key's own; nothing re-centres on gamma.
		expect(scrollIntoView).not.toHaveBeenCalledWith({
			index: 2,
			align: "center",
		})
	})

	it("does not scroll when nothing matches", async () => {
		render(<Harness />)

		await userEvent.type(searchBox(), "zzzz")

		expect(scrollIntoView).not.toHaveBeenCalled()
	})

	// Clearing the box is not a search result, so the view stays where it is.
	it("does not scroll when the query is cleared", async () => {
		render(<Harness />)
		await userEvent.type(searchBox(), "gamma")
		scrollIntoView.mockClear()

		await userEvent.clear(searchBox())

		expect(scrollIntoView).not.toHaveBeenCalled()
	})
})

// Cmd/Ctrl+Arrow jumps to the ends of the history, alongside the Home/End that
// already did.
describe("jumping to the ends of the railway", () => {
	function list() {
		return screen.getByRole("listbox", { name: "Commits" })
	}

	it.each([
		["Home", {}, "H1"],
		["End", {}, "H4"],
		["ArrowUp", { metaKey: true }, "H1"],
		["ArrowDown", { metaKey: true }, "H4"],
		["ArrowUp", { ctrlKey: true }, "H1"],
		["ArrowDown", { ctrlKey: true }, "H4"],
	])("%s%o selects %s", (key, mods, expected) => {
		const onSelect = vi.fn()
		render(<Harness onSelect={onSelect} />)

		fireEvent.keyDown(list(), { key, ...mods })

		expect(onSelect).toHaveBeenLastCalledWith(expected)
	})

	// Without the modifier the arrows still step by one.
	it("keeps the plain arrows stepping one commit", () => {
		const onSelect = vi.fn()
		render(<Harness onSelect={onSelect} />)

		fireEvent.keyDown(list(), { key: "ArrowDown" })

		expect(onSelect).toHaveBeenLastCalledWith("H1")
	})
})
