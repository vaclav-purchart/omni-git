import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { CommandPalette } from "./CommandPalette"

const REFS = ["main", "develop", "fix/P20009663-13723-properties"]

function renderPalette(
	props: Partial<React.ComponentProps<typeof CommandPalette>> = {},
) {
	const onRun = vi.fn()
	const onClose = vi.fn()
	render(
		<CommandPalette
			refs={REFS}
			history={[]}
			onRun={onRun}
			onClose={onClose}
			{...props}
		/>,
	)
	return { onRun, onClose }
}

const field = () => screen.getByLabelText("Git command")

describe("CommandPalette", () => {
	it("focuses the input on open", () => {
		renderPalette()

		expect(field()).toHaveFocus()
	})

	it("runs the typed command on Enter", async () => {
		const { onRun } = renderPalette()

		await userEvent.type(field(), "git checkout main{Enter}")

		expect(onRun).toHaveBeenCalledWith("git checkout main")
	})

	it("does not run an empty or whitespace-only command", async () => {
		const { onRun } = renderPalette()

		await userEvent.type(field(), "   {Enter}")

		expect(onRun).not.toHaveBeenCalled()
	})

	it("closes on Escape without running anything", async () => {
		const { onRun, onClose } = renderPalette()

		await userEvent.type(field(), "git reset --hard")
		await userEvent.keyboard("{Escape}")

		expect(onClose).toHaveBeenCalled()
		expect(onRun).not.toHaveBeenCalled()
	})

	// One Escape should dismiss one thing: the output panel behind the palette
	// listens on window and stands down on defaultPrevented.
	it("claims Escape so outer handlers don't also fire", () => {
		renderPalette()
		const outer = vi.fn()
		window.addEventListener("keydown", outer)

		const e = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		})
		field().dispatchEvent(e)

		expect(e.defaultPrevented).toBe(true)
		window.removeEventListener("keydown", outer)
	})

	it("closes when the backdrop is clicked", async () => {
		const { onClose } = renderPalette()

		await userEvent.click(
			document.querySelector(".palette-backdrop") as Element,
		)

		expect(onClose).toHaveBeenCalled()
	})

	it("stays open when the panel itself is clicked", async () => {
		const { onClose } = renderPalette()

		await userEvent.click(document.querySelector(".palette") as Element)

		expect(onClose).not.toHaveBeenCalled()
	})

	describe("history", () => {
		const history = ["git status", "git fetch --all", "git checkout main"]

		it("walks back through history with ArrowUp", async () => {
			renderPalette({ history })

			await userEvent.keyboard("{ArrowUp}")
			expect(field()).toHaveValue("git status")

			await userEvent.keyboard("{ArrowUp}")
			expect(field()).toHaveValue("git fetch --all")
		})

		it("walks forward again with ArrowDown, back to the empty line", async () => {
			renderPalette({ history })

			await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowDown}")
			expect(field()).toHaveValue("git status")

			await userEvent.keyboard("{ArrowDown}")
			expect(field()).toHaveValue("")
		})

		it("stops at the oldest entry", async () => {
			renderPalette({ history })

			await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}")

			expect(field()).toHaveValue("git checkout main")
		})

		it("does nothing with an empty history", async () => {
			renderPalette({ history: [] })

			await userEvent.keyboard("{ArrowUp}")

			expect(field()).toHaveValue("")
		})

		it("runs a recalled command as-is", async () => {
			const { onRun } = renderPalette({ history })

			await userEvent.keyboard("{ArrowUp}{Enter}")

			expect(onRun).toHaveBeenCalledWith("git status")
		})
	})

	describe("tab completion", () => {
		it("completes a unique subcommand and adds a space", async () => {
			renderPalette()

			await userEvent.type(field(), "stat")
			await userEvent.keyboard("{Tab}")

			expect(field()).toHaveValue("status ")
		})

		// Shell behaviour: first Tab takes you as far as is unambiguous. "st"
		// matches stash + status, which share "sta".
		it("inserts the shared prefix when several candidates match", async () => {
			renderPalette()

			await userEvent.type(field(), "st")
			await userEvent.keyboard("{Tab}")

			expect(field()).toHaveValue("sta")
		})

		// Once nothing more is shared, Tab offers the alternatives one at a time.
		// This only works because the cycle remembers the ORIGINAL word: after
		// inserting "stash", re-deriving candidates would complete "stash" itself.
		it("cycles through candidates on repeated Tab", async () => {
			renderPalette()

			await userEvent.type(field(), "sta")
			await userEvent.keyboard("{Tab}")
			expect(field()).toHaveValue("stash")

			await userEvent.keyboard("{Tab}")
			expect(field()).toHaveValue("status")

			// …and wraps back round.
			await userEvent.keyboard("{Tab}")
			expect(field()).toHaveValue("stash")
		})

		// A cycled candidate has no trailing space, so it can still be replaced;
		// typing anything ends the cycle and starts completing afresh.
		it("ends the cycle once the user types", async () => {
			renderPalette()

			await userEvent.type(field(), "sta")
			await userEvent.keyboard("{Tab}")
			expect(field()).toHaveValue("stash")

			await userEvent.type(field(), " pop")
			await userEvent.keyboard("{Tab}")

			// Now completing a ref argument, not still cycling subcommands.
			expect(field()).toHaveValue("stash pop")
		})

		it("completes a branch name for a later argument", async () => {
			renderPalette()

			await userEvent.type(field(), "checkout deve")
			await userEvent.keyboard("{Tab}")

			expect(field()).toHaveValue("checkout develop ")
		})

		// The reason substring matching exists: nobody types the leading digits.
		it("completes a branch from a fragment", async () => {
			renderPalette()

			await userEvent.type(field(), "checkout 13723")
			await userEvent.keyboard("{Tab}")

			expect(field()).toHaveValue("checkout fix/P20009663-13723-properties ")
		})

		it("shows candidates once a word is started", async () => {
			renderPalette()

			await userEvent.type(field(), "che")

			expect(
				screen.getByRole("button", { name: "cherry-pick" }),
			).toBeInTheDocument()
		})

		it("completes when a candidate is clicked", async () => {
			renderPalette()
			await userEvent.type(field(), "che")

			await userEvent.click(screen.getByRole("button", { name: "cherry-pick" }))

			expect(field()).toHaveValue("cherry-pick ")
		})

		it("does not move focus out of the input on Tab", async () => {
			renderPalette()

			await userEvent.type(field(), "stat")
			await userEvent.keyboard("{Tab}")

			expect(field()).toHaveFocus()
		})

		it("does nothing when nothing matches", async () => {
			renderPalette()

			await userEvent.type(field(), "zzzz")
			await userEvent.keyboard("{Tab}")

			expect(field()).toHaveValue("zzzz")
		})
	})
})
