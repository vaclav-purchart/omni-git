import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { GraphRow } from "./graphLayout"
import { WorkingRow } from "./WorkingRow"

const counts = { staged: 1, unstaged: 2, untracked: 0 }

/** What computeGraph produces for an injected working node parented on HEAD. */
const laneToHead: GraphRow = {
	col: 0,
	color: 0,
	width: 1,
	incoming: [],
	outgoing: [{ toCol: 0, color: 0, dashed: false }],
	passThrough: [],
}

function renderRow(
	props: Partial<React.ComponentProps<typeof WorkingRow>> = {},
) {
	return render(
		<WorkingRow
			counts={counts}
			selected={false}
			graphRow={laneToHead}
			branch="feature/x"
			headHash="abcdef1234567"
			onClick={vi.fn()}
			{...props}
		/>,
	)
}

describe("WorkingRow", () => {
	// The gap this closes: the row used to float with no lane, no parent and no
	// branch, so nothing said where the changes belonged.
	it("names the branch the changes are on", () => {
		renderRow()

		expect(screen.getByText("on feature/x")).toBeInTheDocument()
		expect(screen.getByRole("button")).toHaveAttribute(
			"title",
			"Uncommitted changes on feature/x",
		)
	})

	it("falls back to the short hash when HEAD is detached", () => {
		renderRow({ branch: null })

		expect(screen.getByText("on detached at abcdef1")).toBeInTheDocument()
	})

	// Unborn branch, or HEAD not among the loaded commits: nothing to name.
	it("says nothing about a branch when there is no HEAD", () => {
		renderRow({ branch: null, headHash: null })

		expect(screen.queryByText(/^on /)).not.toBeInTheDocument()
		expect(screen.getByRole("button")).toHaveAttribute(
			"title",
			"Uncommitted changes",
		)
	})

	// It's a real graph node with a real edge, but not a commit — hence hollow.
	it("draws a hollow node on the graph lane", () => {
		const { container } = renderRow()

		const node = container.querySelector("circle")
		expect(node?.getAttribute("fill")).toBe("var(--bg)")
		expect(node?.getAttribute("stroke")).not.toBeNull()
		// The outgoing edge to HEAD is drawn by CommitGraph from the graph row.
		expect(container.querySelectorAll("path").length).toBeGreaterThan(0)
	})

	it("shows the change counts", () => {
		renderRow()

		expect(screen.getByText("1 staged · 2 unstaged")).toBeInTheDocument()
	})
})
