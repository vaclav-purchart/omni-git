import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { GitConsole } from "./GitConsole"

const entries = [
	{
		id: "1",
		command: "git -C /r log --max-count=50",
		exit_code: 0,
		duration_ms: 12,
		stderr: "",
		timestamp_ms: 1_700_000_000_000,
	},
	{
		id: "2",
		command: "git -C /r cat-file -e deadbeef",
		exit_code: 128,
		duration_ms: 4,
		stderr: "fatal: Not a valid object name",
		timestamp_ms: 1_700_000_001_000,
	},
]

describe("GitConsole", () => {
	it("lists commands with their exit status when open", () => {
		render(
			<GitConsole
				entries={entries}
				open={true}
				onToggle={vi.fn()}
				onClear={vi.fn()}
				onOpenTerminal={vi.fn()}
				onOpenHelp={vi.fn()}
			/>,
		)
		expect(screen.getByText(/log --max-count=50/)).toBeInTheDocument()
		expect(screen.getByText(/not a valid object name/i)).toBeInTheDocument()
	})

	it("hides the log body when collapsed but keeps the header", () => {
		render(
			<GitConsole
				entries={entries}
				open={false}
				onToggle={vi.fn()}
				onClear={vi.fn()}
				onOpenTerminal={vi.fn()}
				onOpenHelp={vi.fn()}
			/>,
		)
		expect(screen.queryByText(/log --max-count=50/)).not.toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: /git console/i }),
		).toBeInTheDocument()
	})

	it("calls onToggle when the header is clicked", async () => {
		const onToggle = vi.fn()
		render(
			<GitConsole
				entries={entries}
				open={false}
				onToggle={onToggle}
				onClear={vi.fn()}
				onOpenTerminal={vi.fn()}
				onOpenHelp={vi.fn()}
			/>,
		)
		await userEvent.click(screen.getByRole("button", { name: /git console/i }))
		expect(onToggle).toHaveBeenCalledOnce()
	})
})
