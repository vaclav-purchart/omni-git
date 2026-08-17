import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CommitGraph } from "./CommitGraph"

describe("CommitGraph", () => {
	it("renders a node circle and an edge for a simple row", () => {
		const { container } = render(
			<CommitGraph
				row={{
					col: 0,
					color: 0,
					width: 1,
					incoming: [],
					outgoing: [{ toCol: 0, color: 0, dashed: false }],
					passThrough: [],
				}}
			/>,
		)
		expect(container.querySelector("circle")).toBeTruthy()
		expect(container.querySelectorAll("path").length).toBe(1) // one outgoing edge
	})

	it("draws a line per pass-through lane", () => {
		const { container } = render(
			<CommitGraph
				row={{
					col: 1,
					color: 1,
					width: 2,
					incoming: [],
					outgoing: [],
					passThrough: [{ col: 0, color: 3, dashed: false }],
				}}
			/>,
		)
		// one pass-through path + node has no edges here
		expect(container.querySelectorAll("path").length).toBe(1)
	})
})

describe("CommitGraph HEAD node", () => {
	const row = {
		col: 0,
		color: 0,
		width: 1,
		incoming: [],
		outgoing: [],
		passThrough: [],
	}

	// SourceTree-style: the checked-out commit's node is bigger, so the marker
	// sits where the eye already tracks instead of only at the row's far edge.
	it("draws the HEAD node larger and ringed", () => {
		const plain = render(<CommitGraph row={row} />)
		const plainR = Number(
			plain.container.querySelector("circle")?.getAttribute("r"),
		)
		plain.unmount()

		const { container } = render(<CommitGraph row={row} isHead={true} />)
		const node = container.querySelector("circle")

		expect(Number(node?.getAttribute("r"))).toBeGreaterThan(plainR)
		expect(node?.getAttribute("stroke")).toBe("var(--added)")
	})

	it("leaves ordinary nodes unringed", () => {
		const { container } = render(<CommitGraph row={row} />)

		expect(container.querySelector("circle")?.getAttribute("stroke")).toBeNull()
	})

	// The node must stay inside the svg on lane 0, or it clips at the left edge.
	it("keeps the enlarged node within the lane", () => {
		const { container } = render(<CommitGraph row={row} isHead={true} />)
		const node = container.querySelector("circle")

		const r = Number(node?.getAttribute("r"))
		const stroke = Number(node?.getAttribute("stroke-width"))
		const cx = Number(node?.getAttribute("cx"))
		expect(r + stroke / 2).toBeLessThanOrEqual(cx)
	})
})
