import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const commits = [
	{
		hash: "H1",
		parents: [],
		author_name: "A",
		author_email: "a@x",
		timestamp_ms: 0,
		refs: [],
		subject: "one",
	},
	{
		hash: "H2",
		parents: ["H1"],
		author_name: "A",
		author_email: "a@x",
		timestamp_ms: 0,
		refs: [],
		subject: "two",
	},
]
vi.mock("../workspace/useCommits", () => ({
	useCommits: () => ({
		commits,
		loadMore: vi.fn(),
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
vi.mock("react-virtuoso", () => ({
	Virtuoso: () => null, // don't render items; the effect under test doesn't need them
}))

import { CommitRailway } from "./CommitRailway"

describe("CommitRailway selectHash", () => {
	it("selects + consumes the requested hash, and doesn't re-fire once cleared", () => {
		const onSelect = vi.fn()
		const onSelectHashConsumed = vi.fn()
		const { rerender } = render(
			<CommitRailway
				repoPath="/r"
				all={true}
				selectedHash={null}
				selectHash="H2"
				onSelect={onSelect}
				onSelectHashConsumed={onSelectHashConsumed}
			/>,
		)
		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ hash: "H2" }),
		)
		expect(onSelectHashConsumed).toHaveBeenCalledTimes(1)

		// Parent cleared selectHash → re-render with null; must NOT select again.
		onSelect.mockClear()
		rerender(
			<CommitRailway
				repoPath="/r"
				all={true}
				selectedHash="H2"
				selectHash={null}
				onSelect={onSelect}
				onSelectHashConsumed={onSelectHashConsumed}
			/>,
		)
		expect(onSelect).not.toHaveBeenCalled()
	})
})

describe("CommitRailway cross-panel focus", () => {
	it("calls onAdvance on Enter when the target isn't an input", () => {
		const onAdvance = vi.fn()
		render(
			<CommitRailway
				repoPath="/r"
				all={true}
				selectedHash="H1"
				selectHash={null}
				onSelect={vi.fn()}
				onSelectHashConsumed={vi.fn()}
				onAdvance={onAdvance}
			/>,
		)

		fireEvent.keyDown(screen.getByRole("listbox", { name: "Commits" }), {
			key: "Enter",
		})

		expect(onAdvance).toHaveBeenCalledTimes(1)
	})

	it("does not call onAdvance on Enter dispatched from the search input", () => {
		const onAdvance = vi.fn()
		render(
			<CommitRailway
				repoPath="/r"
				all={true}
				selectedHash="H1"
				selectHash={null}
				onSelect={vi.fn()}
				onSelectHashConsumed={vi.fn()}
				onAdvance={onAdvance}
			/>,
		)

		fireEvent.keyDown(screen.getByPlaceholderText("Search message or hash…"), {
			key: "Enter",
		})

		expect(onAdvance).not.toHaveBeenCalled()
	})
})
