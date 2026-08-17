import { render, screen } from "@testing-library/react"
import { forwardRef } from "react"
import { describe, expect, it, vi } from "vitest"

const commits = [
	{
		hash: "H1",
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

const workingStatus = vi.fn()
vi.mock("../ipc/bindings", () => ({
	commands: { workingStatus: (...args: unknown[]) => workingStatus(...args) },
}))

// Renders every commit row for real (unlike the null-render stub used by the
// other railway test) so we can assert on their content. The pinned
// "Uncommitted changes" row is rendered outside this Virtuoso mock entirely
// (it's no longer part of `data`), so it needs no special handling here.
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

describe("CommitRailway working-copy node", () => {
	it("renders an Uncommitted changes row with counts atop the railway", async () => {
		workingStatus.mockResolvedValueOnce({
			status: "ok",
			data: {
				head: "H1",
				staged: [{ status: "M", path: "a.txt" }],
				unstaged: [
					{ status: "M", path: "b.txt" },
					{ status: "M", path: "c.txt" },
				],
				untracked: [],
			},
		})
		renderRailway()
		expect(await screen.findByText("Uncommitted changes")).toBeInTheDocument()
		expect(screen.getByText("1 staged · 2 unstaged")).toBeInTheDocument()
	})

	it("renders no Uncommitted changes row when there are no working changes", async () => {
		workingStatus.mockResolvedValueOnce({
			status: "ok",
			data: { head: "H1", staged: [], unstaged: [], untracked: [] },
		})
		renderRailway()
		expect(await screen.findByText("head commit")).toBeInTheDocument()
		expect(screen.queryByText("Uncommitted changes")).not.toBeInTheDocument()
	})

	it("renders the Uncommitted changes row even when head is null (unborn branch), as long as there are changes", async () => {
		workingStatus.mockResolvedValueOnce({
			status: "ok",
			data: {
				head: null,
				staged: [{ status: "M", path: "a.txt" }],
				unstaged: [],
				untracked: [],
			},
		})
		renderRailway()
		expect(await screen.findByText("Uncommitted changes")).toBeInTheDocument()
		expect(screen.getByText("1 staged")).toBeInTheDocument()
	})
})
