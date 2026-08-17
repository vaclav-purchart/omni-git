import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef } from "react"
import { describe, expect, it, vi } from "vitest"

const commits = [
	{
		hash: "abcdef1234567890",
		parents: ["H0"],
		author_name: "A",
		author_email: "a@x",
		timestamp_ms: 0,
		refs: [],
		subject: "head commit",
	},
	{
		hash: "H0",
		parents: [],
		author_name: "A",
		author_email: "a@x",
		timestamp_ms: 0,
		refs: [],
		subject: "root",
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

// Renders every commit row for real (like CommitRailway.workingNode.test.tsx)
// so we can right-click on an actual row.
vi.mock("react-virtuoso", () => ({
	Virtuoso: forwardRef(function MockVirtuoso(
		// Index-based, matching the real usage: the working row is row 0 when
		// present, so a row index is not a `commits` index.
		props: {
			totalCount: number
			itemContent: (index: number) => React.ReactNode
		},
		ref: React.Ref<HTMLDivElement>,
	) {
		return (
			<div ref={ref}>
				{Array.from({ length: props.totalCount }, (_, index) => (
					<div key={index}>{props.itemContent(index)}</div>
				))}
			</div>
		)
	}),
}))

import { CommitRailway } from "./CommitRailway"

function renderRailway() {
	return render(
		<CommitRailway
			repoPath="/r"
			all={true}
			selectedHash={null}
			selectHash={null}
			onSelect={vi.fn()}
			onSelectHashConsumed={vi.fn()}
		/>,
	)
}

describe("CommitRailway context menu", () => {
	it("opens a menu with Copy SHA-1 to Clipboard and disabled WIP items on right-click", async () => {
		const user = userEvent.setup()
		renderRailway()
		const row = await screen.findByText("head commit")
		await user.pointer({ keys: "[MouseRight]", target: row })

		expect(screen.getByText("Copy SHA-1 to Clipboard")).toBeInTheDocument()
		const wipItem = screen.getByText("Merge…").closest("button")
		expect(wipItem).toBeDisabled()
	})

	it("copies the full hash to the clipboard when Copy SHA-1 to Clipboard is clicked", async () => {
		// userEvent.setup() installs its own navigator.clipboard stub, so our
		// mock must replace it *after* setup() runs (the stub is left
		// configurable, so this simply swaps in ours for the assertion).
		const user = userEvent.setup()
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		})

		renderRailway()
		const row = await screen.findByText("head commit")
		await user.pointer({ keys: "[MouseRight]", target: row })

		await user.click(screen.getByText("Copy SHA-1 to Clipboard"))
		expect(writeText).toHaveBeenCalledWith("abcdef1234567890")
	})
})
