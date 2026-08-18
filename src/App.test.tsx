import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { commands } from "./ipc/bindings"
import {
	getSetting,
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "./settings/settings"

vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		onFocusChanged: vi.fn().mockResolvedValue(() => {}),
	}),
}))

// Virtuoso renders nothing in jsdom (no layout ⇒ zero height), so commit rows
// would be absent. Index-based, matching the real usage.
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

vi.mock("./ipc/bindings", () => ({
	commands: {
		gitStatus: vi
			.fn()
			.mockResolvedValue({ available: true, version: "2.44.0" }),
		listRepos: vi.fn().mockResolvedValue({
			status: "ok",
			data: [{ id: "1", name: "omni-git", path: "/code/omni-git" }],
		}),
		addRepo: vi.fn(),
		removeRepo: vi.fn(),
		logCommits: vi.fn().mockResolvedValue({
			status: "ok",
			data: [
				{
					hash: "c1",
					parents: [],
					author_name: "A",
					author_email: "a@x",
					timestamp_ms: 0,
					refs: [],
					subject: "a commit",
				},
			],
		}),
		listRefs: vi.fn().mockResolvedValue({
			status: "ok",
			data: {
				local: [
					{
						name: "main",
						is_head: true,
						upstream: "origin/main",
						tip: "h1",
						ahead: 2,
						behind: 1,
						upstream_gone: false,
					},
				],
				remotes: [],
				tags: [],
				current: "main",
			},
		}),
		listWorktrees: vi.fn().mockResolvedValue({ status: "ok", data: [] }),
		listStashes: vi.fn().mockResolvedValue({
			status: "ok",
			data: [{ selector: "stash@{0}", message: "WIP on main: retry" }],
		}),
		stashFiles: vi.fn().mockResolvedValue({
			status: "ok",
			data: [{ status: "M", path: "a.txt" }],
		}),
		stashFileDiff: vi.fn().mockResolvedValue({ status: "ok", data: "@@ @@" }),
		stashPush: vi.fn().mockResolvedValue({
			status: "ok",
			data: { ok: true, sha: null, output: "Saved working directory" },
		}),
		restoreStash: vi.fn().mockResolvedValue({
			status: "ok",
			data: { ok: true, sha: null, output: "" },
		}),
		defaultBranch: vi.fn().mockResolvedValue(null),
		forkBase: vi.fn().mockResolvedValue(null),
		branchDiff: vi.fn().mockResolvedValue({ status: "ok", data: [] }),
		branchFileDiff: vi.fn().mockResolvedValue({ status: "ok", data: [] }),
		workingStatus: vi.fn().mockResolvedValue({
			status: "ok",
			data: { head: null, staged: [], unstaged: [], untracked: [] },
		}),
		workingFileDiff: vi.fn().mockResolvedValue({ status: "ok", data: "" }),
		repoOperation: vi.fn().mockResolvedValue({
			status: "ok",
			data: {
				kind: null,
				conflicts: [],
				step: null,
				head_name: null,
				can_skip: false,
			},
		}),
		operationAction: vi.fn().mockResolvedValue({
			status: "ok",
			data: { ok: true, sha: null, output: "" },
		}),
		stageFile: vi.fn().mockResolvedValue({ status: "ok", data: null }),
		unstageFile: vi.fn().mockResolvedValue({ status: "ok", data: null }),
		stageAll: vi.fn().mockResolvedValue({ status: "ok", data: null }),
		unstageAll: vi.fn().mockResolvedValue({ status: "ok", data: null }),
		discardFile: vi.fn().mockResolvedValue({ status: "ok", data: null }),
		recentConsoleEntries: vi.fn().mockResolvedValue([]),
		watchRepo: vi.fn(),
		unwatchRepo: vi.fn(),
		showMainWindow: vi.fn().mockResolvedValue(undefined),
		openTerminal: vi.fn().mockResolvedValue({ status: "ok", data: null }),
		fetch: vi.fn().mockResolvedValue({ status: "ok", data: true }),
		pull: vi.fn().mockResolvedValue({ status: "ok", data: true }),
		push: vi.fn().mockResolvedValue({ status: "ok", data: true }),
		branchOp: vi.fn().mockResolvedValue({ status: "ok", data: true }),
		cherryPick: vi.fn().mockResolvedValue({
			status: "ok",
			data: { ok: true, sha: "c9", output: "" },
		}),
		rewordCommit: vi.fn().mockResolvedValue({
			status: "ok",
			data: { ok: true, sha: "c9", output: "" },
		}),
		reset: vi.fn().mockResolvedValue({ status: "ok", data: true }),
		commitFiles: vi.fn().mockResolvedValue({
			status: "ok",
			data: [{ status: "M", path: "main.rs" }],
		}),
		commitMessage: vi
			.fn()
			.mockResolvedValue({ status: "ok", data: "a commit" }),
		fileDiff: vi.fn().mockResolvedValue({ status: "ok", data: "@@ -1 +1 @@" }),
		saveSettings: vi.fn().mockResolvedValue({ status: "ok", data: null }),
	},
	events: {
		gitConsoleEntry: { listen: vi.fn().mockResolvedValue(() => {}) },
		repoChanged: { listen: vi.fn().mockResolvedValue(() => {}) },
		commandChunk: { listen: vi.fn().mockResolvedValue(() => {}) },
		commandDone: { listen: vi.fn().mockResolvedValue(() => {}) },
	},
}))

/**
 * The log the module-level mock starts with.
 *
 * Defined here so a describe that overrides `logCommits` can restore THIS rather
 * than something that merely looks like it — an afterEach that restored a
 * different subject leaked into every test that ran afterwards.
 */
const DEFAULT_LOG = [
	{
		hash: "c1",
		parents: [],
		author_name: "A",
		author_email: "a@x",
		timestamp_ms: 0,
		refs: [],
		subject: "a commit",
	},
]

function restoreDefaultLog() {
	vi.mocked(commands.logCommits).mockResolvedValue({
		status: "ok",
		data: DEFAULT_LOG,
	} as Awaited<ReturnType<typeof commands.logCommits>>)
}

describe("App", () => {
	beforeEach(() => {
		resetSettings()
	})

	it("shows the launcher, then the workspace after opening a repo", async () => {
		render(<App />)
		const input = await screen.findByPlaceholderText(/search/i)
		await userEvent.type(input, "omni")
		await userEvent.keyboard("{Enter}")
		expect(
			await screen.findByRole("heading", { name: /omni-git/i }),
		).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument()
	})

	it("boots straight into the workspace when a valid last-repo id is stored", async () => {
		setSetting("last-repo", JSON.stringify("1"))
		render(<App />)
		expect(
			await screen.findByRole("heading", { name: /omni-git/i }),
		).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument()
		expect(
			screen.queryByPlaceholderText(/search repositories/i),
		).not.toBeInTheDocument()
	})

	it("falls back to the launcher when the stored last-repo id is unknown", async () => {
		setSetting("last-repo", JSON.stringify("does-not-exist"))
		render(<App />)
		expect(await screen.findByPlaceholderText(/search/i)).toBeInTheDocument()
		expect(
			screen.queryByRole("heading", { name: /omni-git/i }),
		).not.toBeInTheDocument()
	})
})

describe("startup window reveal", () => {
	beforeEach(() => {
		resetSettings()
		vi.mocked(commands.showMainWindow).mockClear()
	})

	// The window is created hidden so startup can't flash the webview's default
	// white before the themed background paints (see index.html's pre-paint
	// script and tauri.conf.json "visible": false).
	it("reveals the window once the boot decision has settled", async () => {
		render(<App />)

		await waitFor(() => expect(commands.showMainWindow).toHaveBeenCalled())
	})

	// REGRESSION GUARD: this used to wait for two animation frames, and macOS
	// suspends rendering for an off-screen window — so rAF never fired and the
	// app stayed invisible until a 5s Rust fallback revealed it. Reveal must
	// depend only on React committing the DOM, never on a frame being painted.
	it("reveals without waiting for an animation frame", () => {
		const rafSpy = vi.spyOn(window, "requestAnimationFrame")

		render(<App />)

		// Called during the commit, with no frame having elapsed.
		expect(commands.showMainWindow).toHaveBeenCalled()
		expect(rafSpy).not.toHaveBeenCalled()
		rafSpy.mockRestore()
	})

	// Otherwise the window would appear showing the launcher and then swap to the
	// restored repo — a second, more annoying flash.
	it("does not reveal it before the last-repo lookup resolves", async () => {
		setSetting("last-repo", JSON.stringify("1"))
		type ReposResult = Awaited<ReturnType<typeof commands.listRepos>>
		let resolveRepos: (v: ReposResult) => void = () => {}
		vi.mocked(commands.listRepos).mockReturnValueOnce(
			new Promise<ReposResult>((res) => {
				resolveRepos = res
			}),
		)

		render(<App />)
		await Promise.resolve()
		expect(commands.showMainWindow).not.toHaveBeenCalled()

		resolveRepos({
			status: "ok",
			data: [{ id: "1", name: "omni-git", path: "/code/omni-git" }],
		})

		await waitFor(() => expect(commands.showMainWindow).toHaveBeenCalled())
	})

	// A failed lookup must not leave an invisible app.
	it("reveals the window even if the lookup fails", async () => {
		setSetting("last-repo", JSON.stringify("1"))
		vi.mocked(commands.listRepos).mockRejectedValueOnce(new Error("boom"))

		render(<App />)

		await waitFor(() => expect(commands.showMainWindow).toHaveBeenCalled())
	})
})

describe("startup screen", () => {
	beforeEach(() => {
		resetSettings()
		vi.mocked(commands.showMainWindow).mockClear()
	})

	// THE fix: with the full repo in settings, the workspace is what renders
	// first. Previously only an id was stored, so the launcher rendered while
	// list_repos was in flight and was then replaced — the reported flash.
	it("renders the workspace on the first paint, without the launcher", () => {
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)

		render(<App />)

		// Synchronously, before any promise has resolved.
		expect(screen.getByTitle("/code/omni-git")).toBeInTheDocument()
		expect(
			screen.queryByPlaceholderText("Search repositories…"),
		).not.toBeInTheDocument()
	})

	it("renders the launcher immediately when no repo is stored", () => {
		render(<App />)

		expect(
			screen.getByPlaceholderText("Search repositories…"),
		).toBeInTheDocument()
	})

	// Legacy entries can't be resolved synchronously, so show nothing rather than
	// guessing at the launcher and swapping.
	it("shows neither screen while a legacy id is being resolved", async () => {
		setSetting("last-repo", JSON.stringify("1"))
		type ReposResult = Awaited<ReturnType<typeof commands.listRepos>>
		let resolveRepos: (v: ReposResult) => void = () => {}
		vi.mocked(commands.listRepos).mockReturnValueOnce(
			new Promise<ReposResult>((res) => {
				resolveRepos = res
			}),
		)

		render(<App />)
		expect(
			screen.queryByPlaceholderText("Search repositories…"),
		).not.toBeInTheDocument()
		expect(screen.queryByTitle("/code/omni-git")).not.toBeInTheDocument()
		expect(commands.showMainWindow).not.toHaveBeenCalled()

		resolveRepos({
			status: "ok",
			data: [{ id: "1", name: "omni-git", path: "/code/omni-git" }],
		})

		expect(await screen.findByTitle("/code/omni-git")).toBeInTheDocument()
	})

	// A repo removed since last run must not strand the user in a broken
	// workspace.
	it("falls back to the launcher when the stored repo is gone", async () => {
		setSetting(
			"last-repo",
			JSON.stringify({ id: "gone", name: "old", path: "/old" }),
		)

		render(<App />)

		expect(
			await screen.findByPlaceholderText("Search repositories…"),
		).toBeInTheDocument()
		expect(getSetting("last-repo")).toBeNull()
	})

	// So the next launch takes the fast path.
	it("upgrades a legacy id entry to the full record", async () => {
		setSetting("last-repo", JSON.stringify("1"))

		render(<App />)
		await screen.findByTitle("/code/omni-git")

		expect(JSON.parse(getSetting("last-repo") as string)).toEqual({
			id: "1",
			name: "omni-git",
			path: "/code/omni-git",
		})
	})
})

describe("refresh shortcut", () => {
	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
	})

	// Same effect as the ↻ button, from any panel — the listener is on the window,
	// so it doesn't matter what has focus.
	it("re-reads the repo on Cmd/Ctrl+R", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")
		await waitFor(() => expect(commands.logCommits).toHaveBeenCalled())
		const before = vi.mocked(commands.listRefs).mock.calls.length

		fireEvent.keyDown(window, { code: "KeyR", metaKey: true })

		await waitFor(() =>
			expect(vi.mocked(commands.listRefs).mock.calls.length).toBeGreaterThan(
				before,
			),
		)
	})

	// Cmd/Ctrl+R is the browser's reload accelerator. Letting it through would
	// reload the webview and discard the session instead of refreshing data.
	it("prevents the browser's default reload", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")

		const e = new KeyboardEvent("keydown", {
			code: "KeyR",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		})
		window.dispatchEvent(e)

		expect(e.defaultPrevented).toBe(true)
	})

	it("ignores plain R, so typing is unaffected", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")
		await waitFor(() => expect(commands.listRefs).toHaveBeenCalled())
		const before = vi.mocked(commands.listRefs).mock.calls.length

		fireEvent.keyDown(window, { code: "KeyR" })

		expect(vi.mocked(commands.listRefs).mock.calls.length).toBe(before)
	})
})

// The predicate is unit-tested in workspace/shortcuts.test.ts; these cover the
// WIRING, which nothing did — a listener that never got attached, or a key
// swallowed before it reached the window, would have looked exactly like the
// palette being broken.
describe("command palette shortcut", () => {
	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
	})

	it("opens the palette on Cmd+Shift+P", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")

		fireEvent.keyDown(window, {
			code: "KeyP",
			key: "P",
			metaKey: true,
			shiftKey: true,
		})

		expect(
			await screen.findByRole("textbox", { name: "Git command" }),
		).toBeInTheDocument()
	})

	it("opens the palette on Ctrl+Shift+P", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")

		fireEvent.keyDown(window, {
			code: "KeyP",
			key: "P",
			ctrlKey: true,
			shiftKey: true,
		})

		expect(
			await screen.findByRole("textbox", { name: "Git command" }),
		).toBeInTheDocument()
	})

	// Shift is what keeps the palette clear of the webview's print accelerator.
	// Reported as "the palette is broken" — it was the wrong combination.
	it("ignores a plain Cmd+P", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")

		fireEvent.keyDown(window, { code: "KeyP", key: "p", metaKey: true })

		expect(
			screen.queryByRole("textbox", { name: "Git command" }),
		).not.toBeInTheDocument()
	})
})

describe("bottom-bar terminal and help", () => {
	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
		vi.mocked(commands.openTerminal).mockClear()
	})

	// Opens at the REPO ROOT, which is the only directory that makes sense here.
	it("opens a terminal in the repository folder", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")

		await userEvent.click(
			screen.getByLabelText("Open a terminal in the repository folder"),
		)

		expect(commands.openTerminal).toHaveBeenCalledWith("/code/omni-git", null)
	})

	// null means "auto-detect"; a configured command must be passed through.
	it("passes the configured terminal command", async () => {
		setSetting("terminal-command", JSON.stringify("ghostty {dir}"))
		render(<App />)
		await screen.findByTitle("/code/omni-git")

		await userEvent.click(
			screen.getByLabelText("Open a terminal in the repository folder"),
		)

		expect(commands.openTerminal).toHaveBeenCalledWith(
			"/code/omni-git",
			"ghostty {dir}",
		)
	})

	// A silent no-op would look like a broken button.
	it("reports a failure to open a terminal", async () => {
		vi.mocked(commands.openTerminal).mockResolvedValueOnce({
			status: "error",
			error: "No known terminal found.",
		} as Awaited<ReturnType<typeof commands.openTerminal>>)
		render(<App />)
		await screen.findByTitle("/code/omni-git")

		await userEvent.click(
			screen.getByLabelText("Open a terminal in the repository folder"),
		)

		expect(
			await screen.findByText(/Could not open a terminal/),
		).toBeInTheDocument()
	})

	it("opens help from the bottom bar", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")

		await userEvent.click(screen.getByLabelText("Shortcuts and settings"))

		expect(
			screen.getByLabelText("Search shortcuts and settings"),
		).toBeInTheDocument()
	})
})

describe("remote operations", () => {
	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
		vi.mocked(commands.fetch).mockClear()
		vi.mocked(commands.push).mockClear()
		vi.mocked(commands.pull).mockClear()
	})

	// Fetching goes through a dialog with the same shape as Reset's: pick how it
	// should behave, confirm, and the choice is remembered for next time.
	it("fetches with pruning by default", async () => {
		const user = userEvent.setup()
		render(<App />)

		await user.click(await screen.findByLabelText("Fetch"))
		const dialog = screen.getByRole("dialog", { name: "Fetch" })
		expect(
			within(dialog).getByRole("radio", { name: /Prune deleted/ }),
		).toBeChecked()
		await user.click(within(dialog).getByRole("button", { name: "Fetch" }))

		expect(commands.fetch).toHaveBeenCalledWith(
			"/code/omni-git",
			true,
			expect.any(String),
		)
	})

	// --prune drops remote-TRACKING refs for branches deleted upstream. It never
	// touches local branches — but keeping a stale `origin/foo` is a legitimate
	// preference, so it is a choice rather than a fact of fetching.
	it("can fetch without pruning, and remembers that", async () => {
		const user = userEvent.setup()
		render(<App />)

		await user.click(await screen.findByLabelText("Fetch"))
		let dialog = screen.getByRole("dialog", { name: "Fetch" })
		await user.click(
			within(dialog).getByRole("radio", { name: /Keep every remote/ }),
		)
		await user.click(within(dialog).getByRole("button", { name: "Fetch" }))

		expect(commands.fetch).toHaveBeenCalledWith(
			"/code/omni-git",
			false,
			expect.any(String),
		)
		expect(getSetting("fetch-mode")).toBe(JSON.stringify("keep"))

		// Re-opening starts on the remembered choice.
		await user.click(screen.getByLabelText("Fetch"))
		dialog = screen.getByRole("dialog", { name: "Fetch" })
		expect(
			within(dialog).getByRole("radio", { name: /Keep every remote/ }),
		).toBeChecked()
	})

	it("does not fetch when the dialog is cancelled", async () => {
		const user = userEvent.setup()
		render(<App />)

		await user.click(await screen.findByLabelText("Fetch"))
		await user.click(
			within(screen.getByRole("dialog", { name: "Fetch" })).getByRole(
				"button",
				{ name: "Cancel" },
			),
		)

		expect(commands.fetch).not.toHaveBeenCalled()
	})

	it("pulls from the header", async () => {
		render(<App />)
		await userEvent.click(await screen.findByLabelText("Pull"))

		expect(commands.pull).toHaveBeenCalledWith(
			"/code/omni-git",
			expect.any(String),
		)
	})

	// The branch in the fixture HAS an upstream, so no -u.
	it("pushes without setting upstream when one exists", async () => {
		render(<App />)
		await userEvent.click(await screen.findByLabelText("Push"))

		expect(commands.push).toHaveBeenCalledWith(
			"/code/omni-git",
			false,
			expect.any(String),
		)
	})

	// Ahead/behind come from git's own %(upstream:track), and are what make the
	// buttons worth looking at.
	it("shows the ahead and behind counts", async () => {
		render(<App />)

		expect(await screen.findByLabelText("Push")).toHaveTextContent("2")
		expect(screen.getByLabelText("Pull")).toHaveTextContent("1")
	})

	it("asks git to set upstream for a branch that has none", async () => {
		// Once, not persistently: a mockResolvedValue here leaks this branch list
		// into every later test in the file.
		vi.mocked(commands.listRefs).mockResolvedValueOnce({
			status: "ok",
			data: {
				local: [
					{
						name: "wip",
						is_head: true,
						upstream: null,
						tip: "h1",
						ahead: 0,
						behind: 0,
						upstream_gone: false,
					},
				],
				remotes: [],
				tags: [],
				current: "wip",
			},
		} as Awaited<ReturnType<typeof commands.listRefs>>)

		render(<App />)
		await userEvent.click(await screen.findByLabelText("Push"))

		expect(commands.push).toHaveBeenCalledWith(
			"/code/omni-git",
			true,
			expect.any(String),
		)
	})
})

describe("branch operations", () => {
	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
		vi.mocked(commands.branchOp).mockClear()
	})

	// fireEvent rather than userEvent.pointer: in the full app tree userEvent's
	// pointer-events check refuses the click (the panel library's inline styles),
	// while the handler under test is a plain onContextMenu.
	async function rightClick(label: string) {
		const row = (await screen.findByText(label)).closest("button")
		fireEvent.contextMenu(row as Element)
		return userEvent.setup()
	}

	it("checks out a local branch from the sidebar", async () => {
		render(<App />)
		const user = await rightClick("main")

		await user.click(screen.getByText("Checkout main"))

		expect(commands.branchOp).toHaveBeenCalledWith(
			"/code/omni-git",
			{ kind: "Checkout", target: "main" },
			expect.any(String),
		)
	})

	// A ref badge on a commit row is the same ref as in the sidebar, so it offers
	// the same actions. Without this, checking out a branch you can already see in
	// the log meant going to find it in the sidebar first.
	describe("from a ref badge on a commit row", () => {
		const DECORATED = {
			hash: "c1",
			parents: [],
			author_name: "A",
			author_email: "a@x",
			timestamp_ms: 0,
			refs: ["HEAD -> main", "refs/remotes/origin/feature", "tag: v1.0"],
			subject: "a commit",
		}

		beforeEach(() => {
			vi.mocked(commands.logCommits).mockResolvedValue({
				status: "ok",
				data: [DECORATED],
			} as Awaited<ReturnType<typeof commands.logCommits>>)
		})

		// Restored explicitly: a persistent mockResolvedValue outlives this block and
		// would hand decorated commits to every later test in the file.
		afterEach(restoreDefaultLog)

		// "main" is also a sidebar entry, so the badge has to be picked by class
		// rather than by text alone.
		async function rightClickBadge(label: string) {
			const badge = (await screen.findAllByText(label)).find((el) =>
				el.classList.contains("commit-ref"),
			)
			expect(badge).toBeDefined()
			fireEvent.contextMenu(badge as Element)
			return userEvent.setup()
		}

		it("checks out a local branch", async () => {
			render(<App />)
			const user = await rightClickBadge("main")

			await user.click(screen.getByText("Checkout main"))

			expect(commands.branchOp).toHaveBeenCalledWith(
				"/code/omni-git",
				{ kind: "Checkout", target: "main" },
				expect.any(String),
			)
		})

		// A remote-tracking ref can't be checked out as-is; it becomes a local branch
		// that tracks it.
		it("checks out a remote branch as a local one", async () => {
			render(<App />)
			const user = await rightClickBadge("origin/feature")

			await user.click(screen.getByText("Checkout as Local Branch"))

			expect(commands.branchOp).toHaveBeenCalledWith(
				"/code/omni-git",
				{ kind: "CheckoutRemote", remote_ref: "origin/feature" },
				expect.any(String),
			)
		})

		it("checks out a tag, detaching HEAD", async () => {
			render(<App />)
			const user = await rightClickBadge("v1.0")

			await user.click(screen.getByText("Checkout v1.0 (detached)"))

			expect(commands.branchOp).toHaveBeenCalledWith(
				"/code/omni-git",
				{ kind: "CheckoutCommit", commit: "v1.0" },
				expect.any(String),
			)
		})

		// The commit menu is what the rest of the row gives; a badge must not be a
		// second way to reach it, or the ref actions would be unreachable.
		it("offers ref actions, not the commit menu", async () => {
			render(<App />)
			await rightClickBadge("main")

			expect(
				screen.queryByText("Reset to this commit…"),
			).not.toBeInTheDocument()
			expect(screen.getByText("Delete main…")).toBeInTheDocument()
		})

		// A badge's menu IS the sidebar's menu for the same ref (both call
		// buildRefMenu), so the copy actions have to be there too.
		describe("copy actions", () => {
			function stubClipboard() {
				const writeText = vi.fn().mockResolvedValue(undefined)
				const user = userEvent.setup()
				Object.defineProperty(navigator, "clipboard", {
					value: { writeText },
					configurable: true,
				})
				return { writeText, user }
			}

			it.each([
				["main", "Copy Branch Name to Clipboard", "main"],
				[
					"origin/feature",
					"Copy Remote Branch Name to Clipboard",
					"origin/feature",
				],
				["v1.0", "Copy Tag Name to Clipboard", "v1.0"],
			])("copies %s from its badge", async (label, item, expected) => {
				const { writeText, user } = stubClipboard()
				render(<App />)
				const badge = (await screen.findAllByText(label)).find((el) =>
					el.classList.contains("commit-ref"),
				)
				fireEvent.contextMenu(badge as Element)

				await user.click(screen.getByText(item))

				expect(writeText).toHaveBeenCalledWith(expected)
			})
		})

		// A bare HEAD badge (detached) names no ref, so it has no ref menu — but the
		// badge swallows the event to keep the two menus apart, which left it as a
		// patch of row where right-click did nothing at all.
		it("falls back to the commit menu on a detached HEAD badge", async () => {
			vi.mocked(commands.logCommits).mockResolvedValue({
				status: "ok",
				data: [{ ...DECORATED, refs: ["HEAD"] }],
			} as Awaited<ReturnType<typeof commands.logCommits>>)
			render(<App />)

			const badge = (await screen.findAllByText("HEAD")).find((el) =>
				el.classList.contains("commit-ref"),
			)
			fireEvent.contextMenu(badge as Element)

			expect(
				await screen.findByText("Reset to this commit…"),
			).toBeInTheDocument()
		})
	})

	// Rewording goes through a dialog because the message has to be FETCHED — the
	// railway only carries the subject, and rewording from that would drop bodies.
	describe("rewording a commit", () => {
		const FULL = "a commit\n\nWith a body."

		// mockResolvedValue, not Once: selecting a commit ALSO loads its message for
		// the detail panel, and the app selects one on load — a Once would be eaten
		// before the dialog ever asked.
		beforeEach(() => {
			vi.mocked(commands.rewordCommit).mockClear()
			vi.mocked(commands.commitMessage).mockClear()
			vi.mocked(commands.commitMessage).mockResolvedValue({
				status: "ok",
				data: FULL,
			} as Awaited<ReturnType<typeof commands.commitMessage>>)
		})

		afterEach(() => {
			vi.mocked(commands.commitMessage).mockResolvedValue({
				status: "ok",
				data: "a commit",
			} as Awaited<ReturnType<typeof commands.commitMessage>>)
		})

		async function openReword() {
			render(<App />)
			const user = await rightClick("a commit")
			await user.click(screen.getByText("Reword message…"))
			return user
		}

		// The railway only carries %s, so without this fetch every reword would
		// silently delete the commit's body.
		it("prefills the dialog with the commit's full message, body included", async () => {
			await openReword()

			expect(commands.commitMessage).toHaveBeenCalledWith(
				"/code/omni-git",
				"c1",
			)
			// toHaveValue, not findByDisplayValue: the latter normalises whitespace,
			// so it can never match a message with a blank line in it — which is
			// exactly what this test is about.
			const box = await screen.findByRole("textbox", { name: /message/i })
			await waitFor(() => expect(box).toHaveValue(FULL))
		})

		it("rewords with the edited message", async () => {
			const user = await openReword()

			const box = await screen.findByRole("textbox", { name: /message/i })
			await user.clear(box)
			await user.type(box, "a better message")
			await user.click(screen.getByRole("button", { name: /^Reword/ }))

			expect(commands.rewordCommit).toHaveBeenCalledWith(
				"/code/omni-git",
				"c1",
				"a better message",
			)
		})

		// git::reword returns a refusal as ok:false carrying its own explanation —
		// a precondition, or a hook rejecting the message. Silence would look like
		// the reword had worked.
		it("shows git's refusal instead of failing silently", async () => {
			vi.mocked(commands.rewordCommit).mockResolvedValueOnce({
				status: "ok",
				data: {
					ok: false,
					sha: null,
					output: "Rewording an earlier commit rebuilds the ones after it",
				},
			} as Awaited<ReturnType<typeof commands.rewordCommit>>)

			const user = await openReword()
			const box = await screen.findByRole("textbox", { name: /message/i })
			await user.type(box, "!")
			await user.click(screen.getByRole("button", { name: /^Reword/ }))

			expect(
				await screen.findByText(/rebuilds the ones after it/),
			).toBeInTheDocument()
		})

		it("does nothing when cancelled", async () => {
			const user = await openReword()
			await user.click(screen.getByRole("button", { name: "Cancel" }))

			expect(commands.rewordCommit).not.toHaveBeenCalled()
		})
	})

	// Creating a branch needs a name, so it goes through the prompt rather than
	// firing on the click.
	it("prompts for a name before creating a branch", async () => {
		render(<App />)
		const user = await rightClick("main")
		await user.click(screen.getByText("Create Branch Here…"))

		expect(commands.branchOp).not.toHaveBeenCalled()

		await user.type(
			screen.getByRole("textbox", { name: /New branch from/ }),
			"feat/x",
		)
		await user.click(screen.getByRole("button", { name: "Create and switch" }))

		expect(commands.branchOp).toHaveBeenCalledWith(
			"/code/omni-git",
			{
				kind: "Create",
				name: "feat/x",
				start_point: "main",
				checkout: true,
			},
			expect.any(String),
		)
	})

	// Destructive, so it must be confirmed rather than run on the click.
	it("confirms before deleting a branch", async () => {
		render(<App />)
		const user = await rightClick("main")
		await user.click(screen.getByText("Delete main…"))

		expect(commands.branchOp).not.toHaveBeenCalled()

		await user.click(screen.getByRole("button", { name: "Delete" }))

		expect(commands.branchOp).toHaveBeenCalledWith(
			"/code/omni-git",
			{ kind: "Delete", name: "main", force: false },
			expect.any(String),
		)
	})

	it("does nothing when the delete confirmation is cancelled", async () => {
		render(<App />)
		const user = await rightClick("main")
		await user.click(screen.getByText("Delete main…"))
		await user.click(screen.getByRole("button", { name: "Cancel" }))

		expect(commands.branchOp).not.toHaveBeenCalled()
	})

	// git's refusal (dirty tree, unmerged branch) is the only thing that explains
	// a failure, so it has to reach the output panel.
	it("shows git's refusal when an operation fails", async () => {
		vi.mocked(commands.branchOp).mockResolvedValueOnce({
			status: "error",
			error: {
				NonZero: {
					code: 1,
					stderr: "error: local changes would be overwritten",
				},
			},
		} as Awaited<ReturnType<typeof commands.branchOp>>)
		render(<App />)
		const user = await rightClick("main")

		await user.click(screen.getByText("Checkout main"))

		expect(
			await screen.findByText(/local changes would be overwritten/),
		).toBeInTheDocument()
	})
})

describe("command output dismissal", () => {
	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
	})

	/** Produces a finished (error) result in the output panel. */
	async function showOutput() {
		vi.mocked(commands.openTerminal).mockResolvedValueOnce({
			status: "error",
			error: "No known terminal found.",
		} as Awaited<ReturnType<typeof commands.openTerminal>>)
		await userEvent.click(
			screen.getByLabelText("Open a terminal in the repository folder"),
		)
		return screen.findByText(/Could not open a terminal/)
	}

	it("dismisses finished output when a commit row is clicked", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")
		await showOutput()

		await userEvent.click(screen.getByText("a commit"))

		expect(
			screen.queryByText(/Could not open a terminal/),
		).not.toBeInTheDocument()
	})

	it("dismisses finished output when a branch is clicked", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")
		await showOutput()

		await userEvent.click(screen.getByText("main"))

		expect(
			screen.queryByText(/Could not open a terminal/),
		).not.toBeInTheDocument()
	})

	it("dismisses finished output when a file is opened", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")
		// Select a commit so its file list is shown.
		await userEvent.click(await screen.findByText("a commit"))
		const file = await screen.findByText("main.rs")
		await showOutput()

		await userEvent.click(file)

		expect(
			screen.queryByText(/Could not open a terminal/),
		).not.toBeInTheDocument()
	})

	// THE regression this guards: a successful commit selects the new commit
	// PROGRAMMATICALLY, and if that counted as navigation the commit would
	// instantly hide its own "Committed" output.
	it("keeps output when the selection changes without a click", async () => {
		render(<App />)
		await screen.findByTitle("/code/omni-git")
		await showOutput()

		// Arrow-key navigation moves the selection without a row click.
		const railway = document.querySelector(".railway") as HTMLElement
		railway.focus()
		fireEvent.keyDown(railway, { key: "ArrowDown" })

		expect(screen.getByText(/Could not open a terminal/)).toBeInTheDocument()
	})
})

describe("reset", () => {
	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
		vi.mocked(commands.reset).mockClear()
	})

	async function openResetDialog() {
		render(<App />)
		const row = (await screen.findByText("a commit")).closest("button")
		fireEvent.contextMenu(row as Element)
		const user = userEvent.setup()
		await user.click(screen.getByText("Reset to this commit…"))
		return user
	}

	// Mixed is the common case: drop a WIP commit, keep its changes to re-stage.
	it("resets with the chosen mode", async () => {
		const user = await openResetDialog()

		await user.click(screen.getByRole("button", { name: /^Reset \(Mixed\)/ }))

		expect(commands.reset).toHaveBeenCalledWith(
			"/code/omni-git",
			"Mixed",
			"c1",
			expect.any(String),
		)
	})

	it("passes Hard when chosen", async () => {
		const user = await openResetDialog()

		await user.click(screen.getByRole("radio", { name: /Hard/ }))
		await user.click(screen.getByRole("button", { name: /Reset and discard/ }))

		expect(commands.reset).toHaveBeenCalledWith(
			"/code/omni-git",
			"Hard",
			"c1",
			expect.any(String),
		)
	})

	// Opening the menu item must not reset anything on its own.
	it("does nothing until confirmed", async () => {
		const user = await openResetDialog()

		expect(commands.reset).not.toHaveBeenCalled()
		await user.click(screen.getByRole("button", { name: "Cancel" }))
		expect(commands.reset).not.toHaveBeenCalled()
	})

	// git's refusal (an unmerged path, a locked index) is the only explanation.
	it("surfaces a failure in the output panel", async () => {
		vi.mocked(commands.reset).mockResolvedValueOnce({
			status: "error",
			error: { NonZero: { code: 1, stderr: "fatal: Unable to lock index" } },
		} as Awaited<ReturnType<typeof commands.reset>>)
		const user = await openResetDialog()

		await user.click(screen.getByRole("button", { name: /^Reset \(Mixed\)/ }))

		expect(await screen.findByText(/Unable to lock index/)).toBeInTheDocument()
	})
})

// Shift+click and Cmd/Ctrl+click on commit rows. The action set is deliberately
// thin — see buildMultiCommitMenu for why almost nothing in the single-commit
// menu generalises to a set.
describe("commit multi-selection", () => {
	const LOG = ["c1", "c2", "c3", "c4"].map((hash, i) => ({
		hash,
		parents: i === 0 ? [] : [`c${i}`],
		author_name: "A",
		author_email: "a@x",
		timestamp_ms: 0,
		refs: [],
		subject: `subject ${hash}`,
	}))
	const writeText = vi.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
		writeText.mockClear()
		vi.mocked(commands.logCommits).mockResolvedValue({
			status: "ok",
			data: LOG,
		} as Awaited<ReturnType<typeof commands.logCommits>>)
	})

	afterEach(restoreDefaultLog)

	// A commit's subject appears BOTH on its railway row and in the detail panel
	// once selected, so the row has to be picked by class rather than by text.
	function row(hash: string) {
		const found = screen
			.getAllByText(`subject ${hash}`)
			.map((el) => el.closest("button"))
			.find((b) => b?.className.includes("commit-row"))
		expect(found).toBeDefined()
		return found as HTMLElement
	}

	async function findRow(hash: string) {
		await screen.findAllByText(`subject ${hash}`)
		return row(hash)
	}

	// userEvent.setup() installs its OWN navigator.clipboard stub, so ours has to
	// replace it afterwards or the assertion watches the wrong object.
	function setupWithClipboard() {
		const user = userEvent.setup()
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		})
		return user
	}

	async function selectRange(from: string, to: string) {
		render(<App />)
		const user = setupWithClipboard()
		await user.click(await findRow(from))
		fireEvent.click(row(to), { shiftKey: true })
		return user
	}

	it("copies every SHA in a shift+clicked range, in log order", async () => {
		const user = await selectRange("c2", "c4")

		fireEvent.contextMenu(row("c3"))
		await user.click(screen.getByText("Copy 3 SHA-1s to Clipboard"))

		expect(writeText).toHaveBeenCalledWith("c2\nc3\nc4")
	})

	it("copies short SHAs too", async () => {
		const user = await selectRange("c1", "c2")

		fireEvent.contextMenu(row("c1"))
		await user.click(screen.getByText("Copy 2 short SHA-1s to Clipboard"))

		expect(writeText).toHaveBeenCalledWith("c1\nc2")
	})

	it("adds individual commits with ctrl+click", async () => {
		render(<App />)
		const user = setupWithClipboard()
		await user.click(await findRow("c1"))
		fireEvent.click(row("c3"), { ctrlKey: true })

		fireEvent.contextMenu(row("c3"))
		await user.click(screen.getByText("Copy 2 SHA-1s to Clipboard"))

		expect(writeText).toHaveBeenCalledWith("c1\nc3")
	})

	// A commit outside the selection isn't what was aimed at, so its own menu opens
	// — copying three SHAs after right-clicking a fourth would be a nasty surprise.
	it("falls back to the single-commit menu outside the selection", async () => {
		await selectRange("c1", "c2")

		fireEvent.contextMenu(row("c4"))

		expect(
			screen.queryByText(/Copy 2 SHA-1s to Clipboard/),
		).not.toBeInTheDocument()
		expect(screen.getByText("Reset to this commit…")).toBeInTheDocument()
	})

	// Almost nothing in the single-commit menu is defined for a set: you cannot
	// check out five commits, or reset to five.
	it("does not offer single-commit actions for a selection", async () => {
		await selectRange("c1", "c3")

		fireEvent.contextMenu(row("c2"))

		expect(screen.queryByText("Reset to this commit…")).not.toBeInTheDocument()
		expect(screen.queryByText("Checkout this commit…")).not.toBeInTheDocument()
		expect(screen.queryByText("Reword message…")).not.toBeInTheDocument()
	})

	it("replaces the selection on a plain click", async () => {
		const user = await selectRange("c1", "c3")

		await user.click(row("c4"))
		fireEvent.contextMenu(row("c4"))

		expect(screen.getByText("Reset to this commit…")).toBeInTheDocument()
	})
})

// Copying the open file's path, from the keyboard and from the menu that advertises
// the shortcut.
describe("copy the open file's path", () => {
	const writeText = vi.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
		writeText.mockClear()
	})

	function installClipboard() {
		// After userEvent.setup(), which installs its own stub.
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		})
	}

	// The changed-files panel only exists once a commit is selected, and the
	// commit's subject appears both on its row and in the detail panel — so the row
	// has to be picked by class.
	async function openFile() {
		render(<App />)
		const user = userEvent.setup()
		installClipboard()
		await screen.findAllByText("a commit")
		const row = screen
			.getAllByText("a commit")
			.map((el) => el.closest("button"))
			.find((b) => b?.className.includes("commit-row"))
		await user.click(row as HTMLElement)
		await user.click(await screen.findByText("main.rs"))
		return user
	}

	it("copies it on Cmd+Shift+C", async () => {
		await openFile()

		fireEvent.keyDown(window, {
			code: "KeyC",
			key: "C",
			metaKey: true,
			shiftKey: true,
		})

		expect(writeText).toHaveBeenCalledWith("main.rs")
	})

	it("copies it on Ctrl+Shift+C", async () => {
		await openFile()

		fireEvent.keyDown(window, {
			code: "KeyC",
			key: "C",
			ctrlKey: true,
			shiftKey: true,
		})

		expect(writeText).toHaveBeenCalledWith("main.rs")
	})

	// Cmd/Ctrl+C has to stay the ordinary copy, or selecting a line in a diff and
	// copying it would break.
	it("leaves a plain Cmd+C alone", async () => {
		await openFile()

		fireEvent.keyDown(window, { code: "KeyC", key: "c", metaKey: true })

		expect(writeText).not.toHaveBeenCalled()
	})

	// No open file means no path; the key must pass through rather than clearing
	// the clipboard.
	it("does nothing with no file open", async () => {
		render(<App />)
		userEvent.setup()
		installClipboard()
		await screen.findByRole("heading", { name: /omni-git/i })

		fireEvent.keyDown(window, {
			code: "KeyC",
			key: "C",
			metaKey: true,
			shiftKey: true,
		})

		expect(writeText).not.toHaveBeenCalled()
	})

	// A shortcut nobody can discover is a shortcut nobody uses.
	it("advertises the shortcut in the file's context menu", async () => {
		await openFile()
		// Opening it also puts the path in the diff panel's header, so the row has
		// to be picked by class.
		const row = screen
			.getAllByText("main.rs")
			.map((el) => el.closest("button"))
			.find((b) => b?.className.includes("detail-file"))

		fireEvent.contextMenu(row as Element)

		expect(
			await screen.findByRole("menuitem", { name: /Copy Path To Clipboard/ }),
		).toHaveTextContent(/⌘⇧C|Ctrl\+Shift\+C/)
	})
})

describe("cherry-pick", () => {
	const LOG = ["c1", "c2", "c3"].map((hash, i) => ({
		hash,
		parents: i === 0 ? [] : [`c${i}`],
		author_name: "A",
		author_email: "a@x",
		timestamp_ms: 0,
		refs: [],
		subject: `subject ${hash}`,
	}))

	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
		vi.mocked(commands.cherryPick).mockClear()
		vi.mocked(commands.logCommits).mockResolvedValue({
			status: "ok",
			data: LOG,
		} as Awaited<ReturnType<typeof commands.logCommits>>)
	})

	afterEach(restoreDefaultLog)

	function row(hash: string) {
		return screen
			.getAllByText(`subject ${hash}`)
			.map((el) => el.closest("button"))
			.find((b) => b?.className.includes("commit-row")) as HTMLElement
	}

	async function open(hash: string) {
		render(<App />)
		const user = userEvent.setup()
		await screen.findAllByText(`subject ${hash}`)
		fireEvent.contextMenu(row(hash))
		await user.click(screen.getByText("Cherry Pick…"))
		return user
	}

	it("picks one commit and commits it", async () => {
		const user = await open("c2")

		await user.click(screen.getByRole("button", { name: /^Cherry-pick/ }))

		expect(commands.cherryPick).toHaveBeenCalledWith(
			"/code/omni-git",
			["c2"],
			false,
			expect.any(String),
		)
	})

	// --no-commit: the changes land staged, for review or squashing by hand.
	it("applies without committing when asked", async () => {
		const user = await open("c2")

		await user.click(
			screen.getByRole("radio", { name: /Apply without committing/ }),
		)
		await user.click(screen.getByRole("button", { name: /^Cherry-pick/ }))

		expect(commands.cherryPick).toHaveBeenCalledWith(
			"/code/omni-git",
			["c2"],
			true,
			expect.any(String),
		)
	})

	// Newest-first, exactly as the log had them — the BACKEND reverses into apply
	// order, so the frontend must not reverse them too.
	it("passes a multi-selection newest-first", async () => {
		render(<App />)
		const user = userEvent.setup()
		await screen.findAllByText("subject c1")
		await user.click(row("c1"))
		fireEvent.click(row("c3"), { shiftKey: true })

		fireEvent.contextMenu(row("c2"))
		await user.click(screen.getByText("Cherry Pick 3 commits…"))
		await user.click(screen.getByRole("button", { name: /^Cherry-pick 3/ }))

		expect(commands.cherryPick).toHaveBeenCalledWith(
			"/code/omni-git",
			["c1", "c2", "c3"],
			false,
			expect.any(String),
		)
	})

	it("does nothing when cancelled", async () => {
		const user = await open("c2")

		await user.click(screen.getByRole("button", { name: "Cancel" }))

		expect(commands.cherryPick).not.toHaveBeenCalled()
	})

	// A conflict leaves the repo mid-cherry-pick on purpose, and git's output is
	// the only instructions the app can offer for getting out.
	it("shows git's output when the pick stops", async () => {
		vi.mocked(commands.cherryPick).mockResolvedValueOnce({
			status: "ok",
			data: {
				ok: false,
				sha: null,
				output:
					"error: could not apply c2... fix conflicts and run git cherry-pick --continue",
			},
		} as Awaited<ReturnType<typeof commands.cherryPick>>)

		const user = await open("c2")
		await user.click(screen.getByRole("button", { name: /^Cherry-pick/ }))

		expect(
			await screen.findByText(/fix conflicts and run git cherry-pick/),
		).toBeInTheDocument()
	})
})

describe("stash preview", () => {
	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
		vi.mocked(commands.restoreStash).mockClear()
	})

	async function openStash() {
		render(<App />)
		const user = userEvent.setup()
		await user.click(await screen.findByText("WIP on main: retry"))
		return user
	}

	it("shows the stash's files when it is clicked", async () => {
		await openStash()

		expect(commands.stashFiles).toHaveBeenCalledWith(
			"/code/omni-git",
			"stash@{0}",
		)
		expect(await screen.findByText("a.txt")).toBeInTheDocument()
	})

	it("loads a stashed file's diff", async () => {
		const user = await openStash()

		await user.click(await screen.findByText("a.txt"))

		expect(commands.stashFileDiff).toHaveBeenCalledWith(
			"/code/omni-git",
			"stash@{0}",
			"a.txt",
			false,
			false,
		)
	})

	// Apply keeps the stash; pop drops it once it lands.
	it("applies without dropping", async () => {
		const user = await openStash()

		await user.click(await screen.findByRole("button", { name: "Apply" }))

		expect(commands.restoreStash).toHaveBeenCalledWith(
			"/code/omni-git",
			"stash@{0}",
			false,
			expect.any(String),
		)
	})

	it("pops", async () => {
		const user = await openStash()

		await user.click(await screen.findByRole("button", { name: "Pop" }))

		expect(commands.restoreStash).toHaveBeenCalledWith(
			"/code/omni-git",
			"stash@{0}",
			true,
			expect.any(String),
		)
	})

	// Selecting a commit is a different thing to look at, so the stash preview
	// gets out of the way rather than both competing for the panel.
	it("leaves the stash view when a commit is selected", async () => {
		const user = await openStash()
		expect(await screen.findByText("a.txt")).toBeInTheDocument()

		await user.click(screen.getByText("a commit"))

		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "Pop" }),
			).not.toBeInTheDocument(),
		)
	})
})

describe("the toolbar", () => {
	beforeEach(() => {
		resetSettings()
		setSetting(
			"last-repo",
			JSON.stringify({ id: "1", name: "omni-git", path: "/code/omni-git" }),
		)
		vi.mocked(commands.stashPush).mockClear()
		vi.mocked(commands.branchOp).mockClear()
	})

	// The old control was one button labelled with the state it was IN, which
	// clicking then reversed — so the label read as the action to half the people
	// who saw it. Both options are now visible, with the active one marked.
	describe("the scope control", () => {
		it("shows both options and marks the active one", async () => {
			render(<App />)

			const all = await screen.findByRole("button", { name: "All branches" })
			const current = screen.getByRole("button", { name: "Current branch" })
			expect(all).toHaveAttribute("aria-pressed", "true")
			expect(current).toHaveAttribute("aria-pressed", "false")
		})

		it("switches to the clicked option, not the other one", async () => {
			render(<App />)

			await userEvent.click(
				await screen.findByRole("button", { name: "Current branch" }),
			)

			expect(
				screen.getByRole("button", { name: "Current branch" }),
			).toHaveAttribute("aria-pressed", "true")
			expect(getSetting("scope")).toBe(JSON.stringify("current"))
		})

		// Clicking the option you are already on is a no-op, where the old toggle
		// would have flipped away from it.
		it("does nothing when the active option is clicked", async () => {
			render(<App />)

			await userEvent.click(
				await screen.findByRole("button", { name: "All branches" }),
			)

			expect(
				screen.getByRole("button", { name: "All branches" }),
			).toHaveAttribute("aria-pressed", "true")
		})
	})

	// The git buttons were icon-only: the only way to learn what they did was to
	// hover and wait.
	it("names every git operation on the button", async () => {
		render(<App />)
		await screen.findByRole("heading", { name: /omni-git/i })

		for (const label of ["Fetch", "Pull", "Push", "Stash", "New branch"]) {
			expect(screen.getByRole("button", { name: label })).toHaveTextContent(
				label,
			)
		}
	})

	it("stashes with a message", async () => {
		const user = userEvent.setup()
		render(<App />)

		await user.click(await screen.findByRole("button", { name: "Stash" }))
		// Scoped to the dialog: the sidebar filter is a textbox too, and the toolbar
		// button that opened this is also called "Stash".
		const dialog = screen.getByRole("dialog")
		await user.type(within(dialog).getByRole("textbox"), "wip: retry")
		await user.click(within(dialog).getByRole("button", { name: "Stash" }))

		expect(commands.stashPush).toHaveBeenCalledWith(
			"/code/omni-git",
			"wip: retry",
			expect.any(String),
		)
	})

	it("creates a branch at HEAD", async () => {
		const user = userEvent.setup()
		render(<App />)

		await user.click(await screen.findByRole("button", { name: "New branch" }))
		const dialog = screen.getByRole("dialog")
		await user.type(within(dialog).getByRole("textbox"), "feat/x")
		await user.click(
			within(dialog).getByRole("button", { name: "Create and switch" }),
		)

		expect(commands.branchOp).toHaveBeenCalledWith(
			"/code/omni-git",
			{ kind: "Create", name: "feat/x", start_point: "HEAD", checkout: true },
			expect.any(String),
		)
	})
})
