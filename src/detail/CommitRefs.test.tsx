import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CommitRefs } from "./CommitRefs"

function renderRefs(refs: string[]) {
	const onOpenMenu = vi.fn()
	render(
		<CommitRefs
			refs={refs}
			hash="abc1234"
			actions={{}}
			onOpenMenu={onOpenMenu}
		/>,
	)
	return { onOpenMenu }
}

describe("CommitRefs", () => {
	it("shows the short name of every ref", () => {
		renderRefs([
			"HEAD -> refs/heads/main",
			"refs/remotes/origin/main",
			"tag: refs/tags/v1.0",
		])

		expect(screen.getByText("main")).toBeInTheDocument()
		expect(screen.getByText("origin/main")).toBeInTheDocument()
		expect(screen.getByText("v1.0")).toBeInTheDocument()
	})

	// The panel is narrow; an empty strip would cost a line on every commit that
	// has no refs, which is nearly all of them.
	it("renders nothing when the commit has no refs", () => {
		const { container } = render(
			<CommitRefs refs={[]} hash="abc" actions={{}} onOpenMenu={vi.fn()} />,
		)

		expect(container).toBeEmptyDOMElement()
	})

	it("marks the kind of each ref, so a tag doesn't look like a branch", () => {
		renderRefs(["refs/heads/main", "tag: refs/tags/v1.0"])

		expect(screen.getByText("main")).toHaveClass("ref-local")
		expect(screen.getByText("v1.0")).toHaveClass("ref-tag")
	})

	// The point of showing them here: the tag's name is what you came for.
	it("opens the ref's menu on right-click", () => {
		const { onOpenMenu } = renderRefs(["tag: refs/tags/v1.0"])

		fireEvent.contextMenu(screen.getByText("v1.0"))

		expect(onOpenMenu).toHaveBeenCalled()
		const items = onOpenMenu.mock.calls[0][0] as Array<{ label?: string }>
		expect(items.some((i) => i.label === "Copy Tag Name to Clipboard")).toBe(
			true,
		)
	})

	it("gives a remote branch the remote's menu", () => {
		const { onOpenMenu } = renderRefs(["refs/remotes/origin/feature"])

		fireEvent.contextMenu(screen.getByText("origin/feature"))

		const items = onOpenMenu.mock.calls[0][0] as Array<{ label?: string }>
		expect(
			items.some((i) => i.label === "Copy Remote Branch Name to Clipboard"),
		).toBe(true)
	})

	// A bare HEAD (detached) names no ref, so there is nothing to act on.
	it("opens no menu for a detached HEAD", () => {
		const { onOpenMenu } = renderRefs(["HEAD"])

		fireEvent.contextMenu(screen.getByText("HEAD"))

		expect(onOpenMenu).not.toHaveBeenCalled()
	})
})
