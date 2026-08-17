import { render, screen } from "@testing-library/react"
import { forwardRef } from "react"
import { describe, expect, it, vi } from "vitest"

function commit(hash: string, parents: string[], refs: string[] = []) {
	return {
		hash,
		parents,
		author_name: "A",
		author_email: "a@x",
		timestamp_ms: 0,
		refs,
		subject: `subject ${hash}`,
	}
}

// HEAD is deliberately NOT the newest commit — that's the normal case (it's
// wherever the checked-out tip sorts by date) and the whole reason the working
// node needs a real graph edge instead of a cue aimed at the adjacent row.
const commits = [
	commit("c1", ["c2"]),
	commit("c2", ["head"]),
	commit("head", ["older"], ["HEAD -> main", "origin/main"]),
	commit("older", []),
]

vi.mock("../workspace/useCommits", () => ({
	useCommits: () => ({
		commits,
		loadMore: vi.fn(),
		reload: vi.fn(),
		reachedEnd: true,
		error: null,
	}),
}))

vi.mock("./useWorkingNode", () => ({
	useWorkingNode: () => ({
		node: {
			hash: "__WORKING__",
			parents: [],
			author_name: "",
			author_email: "",
			timestamp_ms: 0,
			refs: [],
			subject: "Uncommitted changes",
		},
		counts: { staged: 1, unstaged: 0, untracked: 0 },
	}),
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: forwardRef(function MockVirtuoso(
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

describe("CommitRailway working-copy lane", () => {
	it("renders the working row first, above the commits", () => {
		const { container } = renderRailway()

		const rows = container.querySelectorAll(".commit-row")
		expect(rows.length).toBe(commits.length + 1)
		expect(rows[0]).toHaveClass("is-working")
	})

	// The payoff of injecting the node: a continuous lane from the working row
	// down to HEAD, three rows below, instead of a stub ending in mid-air.
	it("draws lane segments on every row between the working node and HEAD", () => {
		const { container } = renderRailway()

		const rows = [...container.querySelectorAll(".commit-row")]
		const laneSegments = rows.map(
			(r) => r.querySelectorAll("svg.commit-graph path").length,
		)

		// working row -> its outgoing edge
		expect(laneSegments[0]).toBeGreaterThan(0)
		// c1 and c2 in between -> pass-through segments keeping the line alive
		expect(laneSegments[1]).toBeGreaterThan(0)
		expect(laneSegments[2]).toBeGreaterThan(0)
		// HEAD -> receives it
		expect(laneSegments[3]).toBeGreaterThan(0)
	})

	it("names the branch the uncommitted changes are on", () => {
		renderRailway()

		expect(screen.getByText("on main")).toBeInTheDocument()
	})

	// It's a graph node, but not a commit.
	it("draws the working node hollow", () => {
		const { container } = renderRailway()

		const workingNode = container
			.querySelector(".commit-row.is-working")
			?.querySelector("circle")
		expect(workingNode?.getAttribute("fill")).toBe("var(--bg)")
	})

	// The commit rows must still line up with their own graph rows despite the
	// injected row shifting every index by one.
	it("keeps commit rows aligned with their own graph rows", () => {
		const { container } = renderRailway()

		// HEAD's row is the one marked is-head; with the offset applied correctly
		// that is row index 3 (working + c1 + c2 + head).
		const rows = [...container.querySelectorAll(".commit-row")]
		expect(rows.findIndex((r) => r.classList.contains("is-head"))).toBe(3)
	})
	// It's a real edge, but not a branch: solid lanes read as history, so the run
	// from the working node down to HEAD is dashed — and the history BELOW HEAD
	// stays solid.
	it("dashes the lane down to HEAD and leaves history below it solid", () => {
		const { container } = renderRailway()

		const rows = [...container.querySelectorAll(".commit-row")]
		const dashedCounts = rows.map(
			(r) =>
				[...r.querySelectorAll("svg.commit-graph path")].filter(
					(p) => p.getAttribute("stroke-dasharray") !== null,
				).length,
		)

		expect(dashedCounts[0]).toBeGreaterThan(0) // working -> down
		expect(dashedCounts[1]).toBeGreaterThan(0) // pass-through
		expect(dashedCounts[2]).toBeGreaterThan(0) // pass-through
		expect(dashedCounts[3]).toBeGreaterThan(0) // arriving at HEAD
		// `older`, below HEAD: ordinary history, nothing dashed.
		expect(dashedCounts[4]).toBe(0)
	})
})
