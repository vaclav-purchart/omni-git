import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { CommitRow } from "./CommitRow"

const commit = {
	hash: "abcdef1234567890",
	parents: ["p"],
	author_name: "Ada",
	author_email: "ada@x.io",
	timestamp_ms: 1_700_000_000_000,
	// Full refnames, because the log is read with `--decorate=full` (see
	// git/log.rs). Short names here would hide a ref-kind bug: `origin/main`
	// without its `refs/remotes/` prefix parses as a LOCAL branch.
	refs: ["HEAD -> refs/heads/main", "refs/remotes/origin/main"],
	subject: "Add the thing",
}

const graphRow = {
	col: 0,
	color: 0,
	width: 1,
	incoming: [],
	outgoing: [],
	passThrough: [],
}

describe("CommitRow", () => {
	it("shows subject, author, short hash and ref labels", () => {
		render(
			<CommitRow
				commit={commit}
				graphRow={graphRow}
				nowMs={1_700_000_030_000}
				selected={false}
				matched={false}
				onClick={vi.fn()}
			/>,
		)
		expect(screen.getByText("Add the thing")).toBeInTheDocument()
		expect(screen.getByText("Ada")).toBeInTheDocument()
		expect(screen.getByText("abcdef1")).toBeInTheDocument() // 7-char short hash
		expect(screen.getByText("main")).toBeInTheDocument() // ref label, arrow stripped
		expect(screen.getByText("origin/main")).toBeInTheDocument()
	})

	it("fires onClick", async () => {
		const onClick = vi.fn()
		render(
			<CommitRow
				commit={commit}
				graphRow={graphRow}
				nowMs={Date.now()}
				selected={false}
				matched={false}
				onClick={onClick}
			/>,
		)
		await userEvent.click(screen.getByText("Add the thing"))
		expect(onClick).toHaveBeenCalledOnce()
	})

	describe("ref badges", () => {
		function renderRow(props: Partial<React.ComponentProps<typeof CommitRow>>) {
			render(
				<CommitRow
					commit={commit}
					graphRow={graphRow}
					nowMs={Date.now()}
					selected={false}
					matched={false}
					onClick={vi.fn()}
					{...props}
				/>,
			)
		}

		it("reports the ref that was right-clicked, not the commit", () => {
			const onRefContextMenu = vi.fn()
			renderRow({ onRefContextMenu })

			fireEvent.contextMenu(screen.getByText("origin/main"))

			expect(onRefContextMenu).toHaveBeenCalledWith(
				expect.objectContaining({ kind: "remote", label: "origin/main" }),
				commit,
				expect.anything(),
			)
		})

		// Both handlers are live on the same row, and React bubbles the event. Without
		// stopPropagation the row's handler runs second and replaces the ref menu with
		// the commit menu — the badge would look like it did nothing.
		it("does not also open the commit menu", () => {
			const onContextMenu = vi.fn()
			renderRow({ onContextMenu, onRefContextMenu: vi.fn() })

			fireEvent.contextMenu(screen.getByText("main"))

			expect(onContextMenu).not.toHaveBeenCalled()
		})

		// With no ref handler wired the badge must stay transparent to the row, or
		// right-clicking a branch label would be a dead zone.
		it("falls through to the commit menu when no ref handler is given", () => {
			const onContextMenu = vi.fn()
			renderRow({ onContextMenu })

			fireEvent.contextMenu(screen.getByText("main"))

			expect(onContextMenu).toHaveBeenCalledOnce()
		})

		it("strips the HEAD arrow before reporting the branch", () => {
			const onRefContextMenu = vi.fn()
			renderRow({ onRefContextMenu })

			fireEvent.contextMenu(screen.getByText("main"))

			expect(onRefContextMenu).toHaveBeenCalledWith(
				expect.objectContaining({ kind: "local", label: "main", isHead: true }),
				commit,
				expect.anything(),
			)
		})
	})
})

describe("CommitRow HEAD marking", () => {
	function renderRow(refs: string[], selected = false) {
		render(
			<CommitRow
				commit={{ ...commit, refs }}
				graphRow={graphRow}
				nowMs={1_700_000_030_000}
				selected={selected}
				matched={false}
				onClick={vi.fn()}
			/>,
		)
		return screen.getByRole("button")
	}

	// The repo's actual position, which is usually NOT the row being inspected.
	it("marks the row HEAD points at", () => {
		const row = renderRow(["HEAD -> main", "origin/main"])

		expect(row).toHaveClass("is-head")
		expect(row).toHaveAttribute("aria-current", "true")
	})

	it("marks a detached HEAD's commit too", () => {
		expect(renderRow(["HEAD"])).toHaveClass("is-head")
	})

	it("leaves other commits unmarked", () => {
		const row = renderRow(["origin/main", "tag: v1.0"])

		expect(row).not.toHaveClass("is-head")
		expect(row).not.toHaveAttribute("aria-current")
	})

	// Both facts have to be readable at once, which is why HEAD is an edge
	// marker and selection is a background — they don't compete.
	it("shows both markers when the checked-out commit is also selected", () => {
		const row = renderRow(["HEAD -> main"], true)

		expect(row).toHaveClass("is-head")
		expect(row).toHaveClass("is-selected")
	})
})
