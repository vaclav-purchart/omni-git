import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Sidebar } from "./Sidebar"

// Sidebar takes refs as PROPS now (the workspace owns the single useRepoRefs
// instance), so there's nothing to mock — just a fixture.
const REFS = {
	local: [
		{
			name: "main",
			is_head: true,
			upstream: "origin/main",
			tip: "hMain",
			ahead: 0,
			behind: 0,
			upstream_gone: false,
		},
		{
			name: "feature",
			is_head: false,
			upstream: null,
			tip: "hFeature",
			ahead: 0,
			behind: 0,
			upstream_gone: false,
		},
	],
	remotes: [{ name: "origin/main", remote: "origin", tip: "hOriginMain" }],
	tags: [{ name: "v1.0", tip: "hV1" }],
	current: "main",
}
const WORKTREES = [{ path: "/repo", branch: "main", is_detached: false }]
const STASHES = [{ selector: "stash@{0}", message: "WIP on main: x" }]

function renderSidebar(
	props: Partial<React.ComponentProps<typeof Sidebar>> = {},
) {
	return render(
		<Sidebar
			refs={REFS}
			worktrees={WORKTREES}
			stashes={STASHES}
			error={null}
			activeHash={null}
			onSelectRef={vi.fn()}
			{...props}
		/>,
	)
}

describe("Sidebar", () => {
	it("lists local branches, remotes, tags, and marks the ref matching activeHash", () => {
		renderSidebar({ activeHash: "hMain" })
		expect(screen.getByText("feature")).toBeInTheDocument()
		expect(screen.getByText("v1.0")).toBeInTheDocument()
		expect(screen.getByText("origin/main")).toBeInTheDocument()
		// The row whose tip matches activeHash is marked ACTIVE (i.e. "the commit
		// being inspected"), which is a different thing from being checked out.
		// Use an exact accessible name match ("main") to disambiguate from the
		// "origin/main" remote button, since a /main/ regex would match both.
		const mainRow = screen.getByRole("button", { name: "main" })
		expect(mainRow).toHaveClass("is-active")
	})

	it("calls onSelectRef with the ref's tip hash when clicked", async () => {
		const onSelectRef = vi.fn()
		renderSidebar({ onSelectRef })
		await userEvent.click(screen.getByText("feature"))
		expect(onSelectRef).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "feature",
				tip: "hFeature",
				kind: "local",
			}),
		)
	})

	it("opens a branch context menu with Diff Against Current and Copy Branch Name, with WIP items disabled", async () => {
		const user = userEvent.setup()
		const onDiffRef = vi.fn()
		renderSidebar({
			activeHash: null,
			onSelectRef: vi.fn(),
			onDiffRef: onDiffRef,
		})
		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByText("feature"),
		})

		expect(screen.getByText("Diff Against Current")).toBeInTheDocument()
		expect(
			screen.getByText("Copy Branch Name to Clipboard"),
		).toBeInTheDocument()
		// Still-scaffolded item, to prove WIP items render disabled.
		const wipItem = screen.getByText("Rename…").closest("button")
		expect(wipItem).toBeDisabled()

		await user.click(screen.getByText("Diff Against Current"))
		expect(onDiffRef).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "feature",
				tip: "hFeature",
				kind: "local",
			}),
		)
	})

	it("copies the branch name to the clipboard when Copy Branch Name to Clipboard is clicked", async () => {
		// userEvent.setup() installs its own navigator.clipboard stub, so our
		// mock must replace it *after* setup() runs (the stub is left
		// configurable, so this simply swaps in ours for the assertion).
		const user = userEvent.setup()
		const writeText = vi.fn().mockResolvedValue(undefined)
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		})

		renderSidebar({
			activeHash: null,
			onSelectRef: vi.fn(),
		})
		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByText("feature"),
		})
		await user.click(screen.getByText("Copy Branch Name to Clipboard"))
		expect(writeText).toHaveBeenCalledWith("feature")
	})

	it("opens a tag-specific context menu without merge/rebase/push/track actions", async () => {
		const user = userEvent.setup()
		const onDiffRef = vi.fn()
		renderSidebar({
			activeHash: null,
			onSelectRef: vi.fn(),
			onDiffRef: onDiffRef,
		})
		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByText("v1.0"),
		})

		expect(screen.getByText("Diff Against Current")).toBeInTheDocument()
		expect(screen.getByText("Copy Tag Name to Clipboard")).toBeInTheDocument()
		expect(screen.getByText("Delete v1.0")).toBeInTheDocument()
		expect(screen.queryByText(/Merge/)).not.toBeInTheDocument()
		expect(screen.queryByText(/Push to origin/)).not.toBeInTheDocument()
		expect(screen.queryByText(/Track Remote/)).not.toBeInTheDocument()

		await user.click(screen.getByText("Diff Against Current"))
		expect(onDiffRef).toHaveBeenCalledWith(
			expect.objectContaining({ name: "v1.0", tip: "hV1", kind: "tag" }),
		)
	})

	it("opens a remote-branch-specific context menu with Copy Remote Branch Name to Clipboard", async () => {
		const user = userEvent.setup()
		renderSidebar()
		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByText("origin/main"),
		})

		expect(
			screen.getByText("Copy Remote Branch Name to Clipboard"),
		).toBeInTheDocument()
		expect(screen.getByText("Create Pull Request…")).toBeInTheDocument()
		expect(screen.queryByText(/Push to origin/)).not.toBeInTheDocument()
	})

	it("renders an error state when refs failed to load", () => {
		renderSidebar({ refs: null, error: "boom" })

		expect(screen.getByText("boom")).toBeInTheDocument()
	})
})

describe("Sidebar checked-out branch", () => {
	// The whole point: the branch the repo is ON is a different fact from the
	// commit being inspected, and both need to be visible at once. Previously
	// only the latter was marked, so the actual repo state was invisible.
	it("marks the checked-out branch independently of what is being inspected", () => {
		// Inspecting `feature`'s tip while `main` is the checked-out branch.
		renderSidebar({ activeHash: "hFeature" })

		const main = screen.getByRole("button", { name: "main" })
		const feature = screen.getByRole("button", { name: "feature" })

		expect(main).toHaveClass("is-checked-out")
		expect(main).not.toHaveClass("is-active")
		expect(feature).toHaveClass("is-active")
		expect(feature).not.toHaveClass("is-checked-out")
	})

	it("can show both cues on the same branch", () => {
		renderSidebar({ activeHash: "hMain" })

		const main = screen.getByRole("button", { name: "main" })

		expect(main).toHaveClass("is-checked-out")
		expect(main).toHaveClass("is-active")
	})

	// The visual marker is a dot + font weight, both invisible to assistive
	// tech; aria-current and the title carry the same fact.
	it("exposes the checked-out branch to assistive tech", () => {
		renderSidebar({ activeHash: null, onSelectRef: vi.fn() })

		const main = screen.getByRole("button", { name: "main" })
		expect(main).toHaveAttribute("aria-current", "true")
		expect(main).toHaveAttribute(
			"title",
			expect.stringContaining("checked out"),
		)

		const feature = screen.getByRole("button", { name: "feature" })
		expect(feature).not.toHaveAttribute("aria-current")
	})

	it("marks nothing as checked out on a detached HEAD", () => {
		renderSidebar({
			refs: {
				local: [
					{
						name: "main",
						is_head: false,
						upstream: null,
						tip: "hMain",
						ahead: 0,
						behind: 0,
						upstream_gone: false,
					},
				],
				remotes: [],
				tags: [],
				current: null,
			},
			worktrees: [],
			stashes: [],
		})

		expect(screen.getByRole("button", { name: "main" })).not.toHaveClass(
			"is-checked-out",
		)
	})
})

describe("Sidebar branch operations", () => {
	async function openMenu(label: string) {
		const user = userEvent.setup()
		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByText(label),
		})
		return user
	}

	it("checks out a local branch", async () => {
		const onCheckout = vi.fn()
		renderSidebar({ onCheckout })

		const user = await openMenu("feature")
		await user.click(screen.getByText("Checkout feature"))

		expect(onCheckout).toHaveBeenCalledWith(
			expect.objectContaining({ name: "feature", kind: "local" }),
		)
	})

	// For a remote-tracking ref, "checkout" means creating a local branch that
	// tracks it — the label says so rather than pretending it's the same action.
	it("offers checkout-as-local for a remote branch", async () => {
		const onCheckout = vi.fn()
		renderSidebar({ onCheckout })

		const user = await openMenu("origin/main")
		await user.click(screen.getByText("Checkout as Local Branch"))

		expect(onCheckout).toHaveBeenCalledWith(
			expect.objectContaining({ name: "origin/main", kind: "remote" }),
		)
	})

	it("creates a branch from a ref", async () => {
		const onCreateBranch = vi.fn()
		renderSidebar({ onCreateBranch })

		const user = await openMenu("feature")
		await user.click(screen.getByText("Create Branch Here…"))

		expect(onCreateBranch).toHaveBeenCalledWith("feature")
	})

	// Safe delete and force delete are SEPARATE items, so `-D` (which discards
	// unmerged commits) is never one mis-click away from `-d`.
	it("keeps safe and force delete apart", async () => {
		const onDeleteRef = vi.fn()
		renderSidebar({ onDeleteRef })

		const user = await openMenu("feature")
		await user.click(screen.getByText("Delete feature…"))
		expect(onDeleteRef).toHaveBeenCalledWith(expect.anything(), false)

		onDeleteRef.mockClear()
		await user.pointer({
			keys: "[MouseRight]",
			target: screen.getByText("feature"),
		})
		await user.click(screen.getByText("Force delete feature…"))
		expect(onDeleteRef).toHaveBeenCalledWith(expect.anything(), true)
	})

	// A tag isn't a branch, so checking one out detaches HEAD. The workspace
	// decides that, but the item has to be offered — and it has to say so, because
	// landing in a detached HEAD unannounced is how people lose commits.
	it("offers checkout for a tag, and says it detaches", async () => {
		const onCheckout = vi.fn()
		renderSidebar({ onCheckout })

		const user = await openMenu("v1.0")
		await user.click(screen.getByText("Checkout v1.0 (detached)"))

		expect(onCheckout).toHaveBeenCalledWith(
			expect.objectContaining({ name: "v1.0", kind: "tag" }),
		)
	})
})

// Branch names are paths and the memorable part is in the middle, so the filter
// is substring-based rather than prefix-based (see refFilter).
describe("Sidebar filter", () => {
	function field() {
		return screen.getByRole("textbox", { name: /Filter branches and tags/ })
	}

	it("filters on a substring from the middle of a name", async () => {
		renderSidebar()

		await userEvent.type(field(), "eatur")

		expect(screen.getByText("feature")).toBeInTheDocument()
		expect(screen.queryByText("v1.0")).not.toBeInTheDocument()
	})

	it("filters tags too", async () => {
		renderSidebar()

		await userEvent.type(field(), "v1")

		expect(screen.getByText("v1.0")).toBeInTheDocument()
		expect(screen.queryByText("feature")).not.toBeInTheDocument()
	})

	// A remote branch matching keeps its remote's heading, since which side of the
	// remote a branch is on is most of the answer.
	it("keeps a matching remote branch under its remote", async () => {
		renderSidebar()

		await userEvent.type(field(), "origin/ma")

		expect(screen.getByText("origin/main")).toBeInTheDocument()
		expect(screen.getByText("origin")).toBeInTheDocument()
	})

	it("drops a remote with nothing left", async () => {
		renderSidebar()

		await userEvent.type(field(), "eatur")

		expect(screen.queryByText("origin")).not.toBeInTheDocument()
	})

	it("says so when nothing matches", async () => {
		renderSidebar()

		await userEvent.type(field(), "zzzz")

		expect(screen.getByText(/Nothing matches/)).toBeInTheDocument()
	})

	it("clears with the button", async () => {
		renderSidebar()
		await userEvent.type(field(), "zzzz")

		await userEvent.click(screen.getByRole("button", { name: "Clear filter" }))

		expect(screen.getByText("feature")).toBeInTheDocument()
		expect(field()).toHaveValue("")
	})

	// The field is always present, so Escape's job here is getting rid of a stale
	// filter rather than closing anything.
	it("clears on Escape", async () => {
		renderSidebar()
		await userEvent.type(field(), "zzzz")

		await userEvent.type(field(), "{Escape}")

		expect(field()).toHaveValue("")
		expect(screen.getByText("feature")).toBeInTheDocument()
	})

	it("shows the filtered count in the section heading", async () => {
		renderSidebar()

		await userEvent.type(field(), "eatur")

		const local = screen.getByText("Local").closest("button")
		expect(local).toHaveTextContent("1")
	})
})

// A stash is browsable like a commit: its contents open in the detail panel, and
// apply/pop are offered on it.
describe("Sidebar stashes", () => {
	it("reports the clicked stash", async () => {
		const onSelectStash = vi.fn()
		renderSidebar({ onSelectStash })

		await userEvent.click(screen.getByText("WIP on main: x"))

		expect(onSelectStash).toHaveBeenCalledWith({
			selector: "stash@{0}",
			message: "WIP on main: x",
		})
	})

	it("marks the stash being previewed", () => {
		renderSidebar({ activeStash: "stash@{0}" })

		expect(screen.getByRole("button", { name: "WIP on main: x" })).toHaveClass(
			"is-active",
		)
	})

	// Apply keeps the stash, pop drops it — named so the difference is readable
	// without already knowing git's verbs.
	it("offers apply and pop from the context menu", async () => {
		const user = userEvent.setup()
		const onApplyStash = vi.fn()
		const onPopStash = vi.fn()
		renderSidebar({ onApplyStash, onPopStash })

		fireEvent.contextMenu(screen.getByText("WIP on main: x"))
		await user.click(screen.getByText("Apply stash@{0}"))
		expect(onApplyStash).toHaveBeenCalled()

		fireEvent.contextMenu(screen.getByText("WIP on main: x"))
		await user.click(screen.getByText(/Pop stash@\{0\}/))
		expect(onPopStash).toHaveBeenCalled()
	})

	it("filters stashes by their message", async () => {
		renderSidebar()

		await userEvent.type(
			screen.getByRole("textbox", { name: /Filter branches and tags/ }),
			"WIP",
		)

		expect(screen.getByText("WIP on main: x")).toBeInTheDocument()
		expect(screen.queryByText("v1.0")).not.toBeInTheDocument()
	})
})

// Copying a name out of the sidebar is one of the few actions here that actually
// does something, so it has to be findable rather than buried under the disabled
// WIP entries.
describe("Sidebar copy-name items", () => {
	function stubClipboard() {
		const writeText = vi.fn().mockResolvedValue(undefined)
		const user = userEvent.setup()
		// After setup(), which installs its own stub.
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		})
		return { writeText, user }
	}

	it.each([
		["feature", "Copy Branch Name to Clipboard", "feature"],
		["v1.0", "Copy Tag Name to Clipboard", "v1.0"],
		["origin/main", "Copy Remote Branch Name to Clipboard", "origin/main"],
	])("copies %s via %s", async (row, item, expected) => {
		const { writeText, user } = stubClipboard()
		renderSidebar()

		fireEvent.contextMenu(screen.getByText(row))
		await user.click(screen.getByText(item))

		expect(writeText).toHaveBeenCalledWith(expected)
	})

	// A worktree had no context menu at all, so its path — the thing you want it
	// for, to cd into — was unreachable.
	it("copies a worktree's path", async () => {
		const { writeText, user } = stubClipboard()
		renderSidebar()

		// By its path, not its label: a worktree is labelled with its BRANCH, which
		// collides with the local branch of the same name.
		fireEvent.contextMenu(screen.getByTitle("/repo"))
		await user.click(screen.getByText("Copy Worktree Path to Clipboard"))

		expect(writeText).toHaveBeenCalledWith("/repo")
	})

	it("copies a stash's selector and its message", async () => {
		const { writeText, user } = stubClipboard()
		renderSidebar()

		fireEvent.contextMenu(screen.getByText("WIP on main: x"))
		await user.click(screen.getByText("Copy Stash Name to Clipboard"))
		expect(writeText).toHaveBeenCalledWith("stash@{0}")

		fireEvent.contextMenu(screen.getByText("WIP on main: x"))
		await user.click(screen.getByText("Copy Stash Message to Clipboard"))
		expect(writeText).toHaveBeenCalledWith("WIP on main: x")
	})

	// Above the wall of disabled entries, not below it.
	it("puts copy-name near the top of a branch menu", () => {
		renderSidebar()

		fireEvent.contextMenu(screen.getByText("feature"))

		const labels = screen
			.getAllByRole("menuitem")
			.map((el) => el.textContent ?? "")
		const copyIndex = labels.findIndex((l) => l.startsWith("Copy Branch Name"))
		const firstWip = labels.findIndex((l) => l.startsWith("Merge "))
		expect(copyIndex).toBeGreaterThanOrEqual(0)
		expect(copyIndex).toBeLessThan(firstWip)
	})
})
