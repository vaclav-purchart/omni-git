import {
	ArrowClockwise,
	ArrowDown,
	ArrowUp,
	CaretLeft,
	CloudArrowDown,
	GitBranch,
	GitDiff,
	GitMerge,
	SidebarSimple,
	Stack,
	X,
} from "@phosphor-icons/react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useCallback, useEffect, useRef, useState } from "react"
import {
	type ImperativePanelHandle,
	Panel,
	PanelGroup,
	PanelResizeHandle,
} from "react-resizable-panels"
import { CommandOutput } from "../console/CommandOutput"
import { GitConsole } from "../console/GitConsole"
import { useCommandStream } from "../console/useCommandStream"
import { useGitConsole } from "../console/useGitConsole"
import { CommitDetail } from "../detail/CommitDetail"
import { CompareDetail } from "../detail/CompareDetail"
import { StashDetail } from "../detail/StashDetail"
import { WorkingCopyDetail } from "../detail/WorkingCopyDetail"
import { DiffView } from "../diff/DiffView"
import { HelpOverlay } from "../help/HelpOverlay"
import {
	type BranchOp,
	type CommitSummary,
	commands,
	events,
	type MergeMode,
	type Repo,
	type Stash,
} from "../ipc/bindings"
import { CommandPalette } from "../palette/CommandPalette"
import { useCommandHistory } from "../palette/useCommandHistory"
import { CommitRailway } from "../railway/CommitRailway"
import { WORKING_HASH } from "../railway/working"
import type { RefActions } from "../refs/refMenu"
import { getSetting, panelStorage } from "../settings/settings"
import { Sidebar } from "../sidebar/Sidebar"
import { useRepoRefs } from "../sidebar/useRepoRefs"
import { ThemeToggle } from "../theme/ThemeToggle"
import { BranchPicker } from "../ui/BranchPicker"
import { ConfirmDialog } from "../ui/ConfirmDialog"
import { PromptDialog } from "../ui/PromptDialog"
import { usePersistentState } from "../ui/usePersistentState"
import { CherryPickDialog, type CherryPickMode } from "./CherryPickDialog"
import { FetchDialog } from "./FetchDialog"
import {
	type FocusGate,
	initialFocusGate,
	onFocusChange,
	onRepoChanged,
} from "./focusGate"
import { MergeDialog } from "./MergeDialog"
import { ResetDialog } from "./ResetDialog"
import { RewordDialog } from "./RewordDialog"
import {
	initialSelfChange,
	isSelfChangeEcho,
	markSelfChange,
	type SelfChange,
} from "./selfChange"
import {
	isCopyPathShortcut,
	isMacPlatform,
	isPaletteShortcut,
	isRefreshShortcut,
	refreshShortcutLabel,
} from "./shortcuts"
import "./Workspace.css"

export function Workspace({
	repo,
	onBack,
}: {
	repo: Repo
	onBack: () => void
}) {
	const [selected, setSelected] = useState<CommitSummary | null>(null)
	const [selectHash, setSelectHash] = useState<string | null>(null)
	const [diff, setDiff] = useState("")
	const [diffPath, setDiffPath] = useState<string | null>(null)
	// "Show as text" applies to ONE file, so it's stored as that file's path
	// rather than a boolean — opening another file drops it automatically, with no
	// reset to remember.
	const [forceTextPath, setForceTextPath] = useState<string | null>(null)
	const [ignoreWhitespace, setIgnoreWhitespace] = usePersistentState(
		"ignore-whitespace",
		false,
	)
	const [scope, setScope] = usePersistentState<"all" | "current">(
		"scope",
		"all",
	)
	const [refreshKey, setRefreshKey] = useState(0)
	const [consoleOpen, setConsoleOpen] = usePersistentState(
		"console-open",
		false,
	)
	// Live output of the current write command, shown in the right panel in place
	// of the diff. Owned HERE, not by the panel that ran the command:
	// WorkingCopyDetail unmounts as soon as the selection leaves the working row
	// — which a successful commit does deliberately. Held locally, the output
	// vanished with it, and streaming chunks would lose their listener
	// mid-command.
	const {
		result: output,
		begin: beginRun,
		show: showOutput,
		close: closeOutput,
		closeIfFinished: dismissOutput,
	} = useCommandStream()
	const [activeBranch, setActiveBranch] = useState<string | null>(null)
	const [compareMode, setCompareMode] = useState(false)
	const [compareBase, setCompareBase] = useState<string | null>(null)
	const { entries, clear } = useGitConsole(500)
	// The ONE ref query for the whole workspace: the sidebar renders from this too
	// (it used to run its own, doubling the ref commands on every startup and
	// refresh). Reloads in place on refreshKey — branch tips move after a commit.
	const {
		refs,
		worktrees,
		stashes,
		error: refsError,
	} = useRepoRefs(repo.path, refreshKey)
	const sidebarRef = useRef<ImperativePanelHandle>(null)
	// Cross-panel Enter/Backspace focus flow: commit railway -> file list ->
	// diff view, and back. Each panel's list root is a focusable (tabIndex=0)
	// div; Enter/Backspace on it moves focus to the next/previous ref.
	const railwayRootRef = useRef<HTMLDivElement>(null)
	const filesRootRef = useRef<HTMLDivElement>(null)
	const diffRootRef = useRef<HTMLDivElement>(null)
	// Focus-gating for watcher-driven refreshes: while the window is unfocused,
	// a repoChanged event only marks the view dirty; the deferred refresh runs
	// once when focus returns (see focusGate). Manual ↻ and post-mutation
	// refreshes call setRefreshKey directly and are unaffected.
	const gateRef = useRef<FocusGate>(initialFocusGate)
	// Our own mutations write to `.git`, which the watcher then reports back to
	// us. `refresh()` already re-read everything, so that echo is dropped.
	const selfChangeRef = useRef<SelfChange>(initialSelfChange)
	const [paletteOpen, setPaletteOpen] = useState(false)
	const [helpOpen, setHelpOpen] = useState(false)
	const { history, remember } = useCommandHistory(repo.path)

	const currentBranch = refs?.current ?? null
	const compareHead = activeBranch ?? currentBranch

	const baseOptions = [
		...(refs?.local ?? []).map((b) => b.name),
		...(refs?.remotes ?? []).map((r) => r.name),
	]

	// A reload is now a TOKEN bump, not a React key: the panels re-read in place
	// and keep their contents, scroll and selection. It used to be a key, which
	// remounted the sidebar, railway and file panel — the "whole app blinks"
	// symptom.
	function refresh() {
		selfChangeRef.current = markSelfChange(Date.now())
		setRefreshKey((k) => k + 1)
	}

	// The window-level listener is bound once, so it reads `refresh` through a ref
	// rather than closing over the first render's copy.
	const refreshRef = useRef(refresh)
	refreshRef.current = refresh
	// Same reason: the copy-path shortcut is bound once and must always see the
	// file that is open NOW.
	const diffPathRef = useRef(diffPath)
	diffPathRef.current = diffPath
	const isMac = isMacPlatform()

	useEffect(() => {
		commands.watchRepo(repo.path)
		let cancelled = false
		let unlisten: (() => void) | undefined
		events.repoChanged
			.listen(() => {
				if (isSelfChangeEcho(selfChangeRef.current, Date.now())) {
					return
				}
				const { refreshNow, gate } = onRepoChanged(gateRef.current)
				gateRef.current = gate
				if (refreshNow) {
					setRefreshKey((k) => k + 1)
				}
			})
			.then((fn) => {
				if (cancelled) {
					fn()
				} else {
					unlisten = fn
				}
			})
		return () => {
			cancelled = true
			unlisten?.()
			commands.unwatchRepo()
		}
	}, [repo.path])

	// Global shortcuts, listened for at the WINDOW so they work whichever panel
	// has focus — the railway, the sidebar, the file list, the diff, or a text
	// field. See shortcuts.ts for the matching rules.
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (isPaletteShortcut(e)) {
				e.preventDefault()
				setPaletteOpen(true)
				return
			}
			if (isRefreshShortcut(e)) {
				// Must be prevented: Cmd/Ctrl+R is the browser's reload accelerator,
				// and reloading the webview would discard the session instead of
				// refreshing the repo data.
				e.preventDefault()
				refreshRef.current()
				return
			}
			if (isCopyPathShortcut(e)) {
				// Read through a ref: this listener is bound once, so closing over
				// `diffPath` would copy whatever was open on first render forever.
				const path = diffPathRef.current
				if (path === null) {
					// Nothing open — leave the key alone rather than clearing the
					// clipboard or swallowing it from something else.
					return
				}
				e.preventDefault()
				navigator.clipboard?.writeText(path).catch(() => {})
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [])

	// Track window focus so watcher events can be deferred while the app is in
	// the background and applied in a single catch-up refresh on return.
	useEffect(() => {
		let cancelled = false
		let unlisten: (() => void) | undefined
		getCurrentWindow()
			.onFocusChanged(({ payload: focused }) => {
				const { refreshNow, gate } = onFocusChange(gateRef.current, focused)
				gateRef.current = gate
				if (refreshNow) {
					setRefreshKey((k) => k + 1)
				}
			})
			.then((fn) => {
				if (cancelled) {
					fn()
				} else {
					unlisten = fn
				}
			})
		return () => {
			cancelled = true
			unlisten?.()
		}
	}, [])

	useEffect(() => {
		if (compareMode && compareHead !== null && compareBase === null) {
			commands.forkBase(repo.path, compareHead).then((b) => {
				if (b !== null) {
					setCompareBase(b)
				}
			})
		}
	}, [compareMode, compareHead, compareBase, repo.path])

	async function runPaletteCommand(input: string) {
		setPaletteOpen(false)
		remember(input)
		const runId = beginRun({
			running: `Running: git ${input.replace(/^git\s+/, "")}`,
			ok: `git ${input.replace(/^git\s+/, "")}`,
			error: `Failed: git ${input.replace(/^git\s+/, "")}`,
		})
		const r = await commands.runGitCommand(repo.path, input, runId)
		if (r.status !== "ok") {
			// Never streamed (e.g. a quoting error), so no commandDone will arrive
			// to finalise the panel — report it directly.
			showOutput({
				title: "Could not run command",
				output:
					"NonZero" in r.error ? r.error.NonZero.stderr : String(r.error.Spawn),
				status: "error",
			})
			return
		}
		// The command may have changed anything — branch, index, history — so
		// reload the views regardless of its exit code.
		refresh()
	}

	const forceText = forceTextPath !== null && forceTextPath === diffPath

	// The checked-out branch, which is what fetch/pull/push act on.
	const headBranch = (refs?.local ?? []).find((b) => b.is_head) ?? null
	// A branch with no upstream needs `push -u`; git refuses a plain push.
	const needsUpstream = headBranch !== null && headBranch.upstream === null
	const ahead = headBranch?.ahead ?? 0
	const behind = headBranch?.behind ?? 0
	const pullTitle =
		behind > 0 ? `Pull ${behind} commit${behind === 1 ? "" : "s"}` : "Pull"
	const pushTitle = needsUpstream
		? "Push and set upstream"
		: ahead > 0
			? `Push ${ahead} commit${ahead === 1 ? "" : "s"}`
			: "Push"

	/**
	 * Runs a remote command, streaming into the output panel and reloading after.
	 *
	 * Reloads regardless of exit code: a partly-successful fetch still moved
	 * remote-tracking refs, and a rejected push may still have changed nothing —
	 * either way the displayed state should match reality.
	 */
	async function runRemote(
		label: { running: string; ok: string; error: string },
		invoke: (runId: string) => Promise<{ status: string }>,
	) {
		const runId = beginRun(label)
		const r = await invoke(runId)
		if (r.status !== "ok") {
			showOutput({
				title: label.error,
				output: String((r as { error?: unknown }).error ?? "Command failed"),
				status: "error",
			})
			return
		}
		refresh()
	}

	// Branch operations: the dialogs and the streamed output live here, so the
	// sidebar and railway only report which ref/commit was acted on.
	const [prompt, setPrompt] = useState<{ startPoint: string } | null>(null)
	const [resetTo, setResetTo] = useState<string | null>(null)
	const [confirmDelete, setConfirmDelete] = useState<{
		ref: { name: string; kind: "local" | "remote" | "tag" }
		force: boolean
	} | null>(null)
	// The message is fetched when the dialog opens rather than carried from the
	// row: the railway only has `%s`, and rewording from the subject alone would
	// silently drop every commit's body.
	const [reword, setReword] = useState<{
		hash: string
		isHead: boolean
		original: string | null
	} | null>(null)

	const [fetchOpen, setFetchOpen] = useState(false)
	const [mergeOpen, setMergeOpen] = useState(false)

	async function runMerge(target: string, mode: MergeMode) {
		setMergeOpen(false)
		const runId = beginRun({
			running: `Merging ${target}…`,
			ok: `Merged ${target}`,
			error: `Could not merge ${target}`,
		})
		const r = await commands.merge(repo.path, target, mode, runId)
		if (r.status !== "ok") {
			showOutput({
				title: `Could not merge ${target}`,
				output:
					"NonZero" in r.error ? r.error.NonZero.stderr : String(r.error.Spawn),
				status: "error",
			})
			refresh()
			return
		}
		if (!r.data.ok) {
			// A conflict leaves the conflicting files in the working tree ON PURPOSE
			// — that is the state you resolve from. Git's output says so and names
			// `--abort`, which the command palette can run.
			showOutput({
				title: `Could not merge ${target}`,
				output: r.data.output,
				status: "error",
			})
			refresh()
			return
		}
		showOutput({
			title: `Merged ${target}`,
			output: r.data.output,
			status: "ok",
		})
		// A squash leaves the result staged rather than committed, so the working
		// row is what to look at; otherwise it is the new merge commit.
		setSelectHash(mode === "Squash" ? WORKING_HASH : (r.data.sha ?? null))
		refresh()
	}
	const [stashPrompt, setStashPrompt] = useState(false)

	async function runStashPush(message: string) {
		setStashPrompt(false)
		const runId = beginRun({
			running: "Stashing…",
			ok: "Stashed",
			error: "Could not stash",
		})
		const r = await commands.stashPush(repo.path, message, runId)
		if (r.status !== "ok") {
			showOutput({
				title: "Could not stash",
				output:
					"NonZero" in r.error ? r.error.NonZero.stderr : String(r.error.Spawn),
				status: "error",
			})
			return
		}
		// "No local changes to save" arrives as ok:false — an ordinary answer, so it
		// is reported in git's own words rather than as a failure of the app.
		showOutput({
			title: r.data.ok ? "Stashed" : "Nothing to stash",
			output: r.data.output,
			status: r.data.ok ? "ok" : "error",
		})
		refresh()
	}

	// The stash being previewed. Mutually exclusive with a commit selection: the
	// detail panel shows one thing, and a stash is that thing while it is set.
	const [viewStash, setViewStash] = useState<Stash | null>(null)

	async function runRestoreStash(stash: Stash, pop: boolean) {
		const verb = pop ? "Pop" : "Apply"
		const runId = beginRun({
			running: `${verb}ing ${stash.selector}…`,
			ok: `${pop ? "Popped" : "Applied"} ${stash.selector}`,
			error: `Could not ${verb.toLowerCase()} ${stash.selector}`,
		})
		const r = await commands.restoreStash(repo.path, stash.selector, pop, runId)
		if (r.status !== "ok") {
			showOutput({
				title: `Could not ${verb.toLowerCase()} ${stash.selector}`,
				output:
					"NonZero" in r.error ? r.error.NonZero.stderr : String(r.error.Spawn),
				status: "error",
			})
			refresh()
			return
		}
		if (!r.data.ok) {
			// A conflicting apply leaves the working tree half-merged, and git keeps a
			// popped stash when that happens. Its output says so, and it is the only
			// guidance there is until there's a conflict UI.
			showOutput({
				title: `Could not ${verb.toLowerCase()} ${stash.selector}`,
				output: r.data.output,
				status: "error",
			})
			refresh()
			return
		}
		showOutput({
			title: `${pop ? "Popped" : "Applied"} ${stash.selector}`,
			output: r.data.output,
			status: "ok",
		})
		// The changes are now in the working tree, so that is what to look at — and
		// a popped stash no longer exists to preview.
		setViewStash(null)
		setSelectHash(WORKING_HASH)
		refresh()
	}

	// The commits queued for a cherry-pick, newest-first as the log had them.
	const [cherryPick, setCherryPick] = useState<string[] | null>(null)

	async function runCherryPick(commits: string[], mode: CherryPickMode) {
		setCherryPick(null)
		const n = commits.length
		const what = n === 1 ? commits[0].slice(0, 7) : `${n} commits`
		const runId = beginRun({
			running: `Cherry-picking ${what}…`,
			ok: `Cherry-picked ${what}`,
			error: `Could not cherry-pick ${what}`,
		})
		const r = await commands.cherryPick(
			repo.path,
			commits,
			mode === "stage",
			runId,
		)
		if (r.status !== "ok") {
			showOutput({
				title: `Could not cherry-pick ${what}`,
				output:
					"NonZero" in r.error ? r.error.NonZero.stderr : String(r.error.Spawn),
				status: "error",
			})
			refresh()
			return
		}
		if (!r.data.ok) {
			// A conflict leaves the repo mid-cherry-pick ON PURPOSE — that state is
			// what allows resolving and continuing. Git's own output says so, and it
			// is the only guidance the app can offer, since there is no conflict UI
			// yet; `git cherry-pick --abort` is reachable from the command palette.
			showOutput({
				title: `Could not cherry-pick ${what}`,
				output: r.data.output,
				status: "error",
			})
			// Reload regardless: a partial run may have landed some of the commits.
			refresh()
			return
		}
		showOutput({
			title: `Cherry-picked ${what}`,
			output: r.data.output,
			status: "ok",
		})
		if (mode === "commit" && r.data.sha) {
			setSelectHash(r.data.sha)
		} else {
			// The changes are staged, not committed, so the interesting row is the
			// uncommitted one rather than any commit.
			setSelectHash(WORKING_HASH)
		}
		refresh()
	}

	function openReword(hash: string, isHead: boolean) {
		dismissOutput()
		setReword({ hash, isHead, original: null })
		void commands.commitMessage(repo.path, hash).then((r) => {
			// Guarded on the hash: a slow fetch must not drop a stale message into a
			// dialog the user has since reopened on a different commit.
			setReword((current) =>
				current && current.hash === hash && r.status === "ok"
					? { ...current, original: r.data }
					: current,
			)
		})
	}

	async function runReword(hash: string, message: string) {
		setReword(null)
		const short = hash.slice(0, 7)
		const r = await commands.rewordCommit(repo.path, hash, message)
		if (r.status !== "ok") {
			showOutput({
				title: `Could not reword ${short}`,
				output:
					"NonZero" in r.error ? r.error.NonZero.stderr : String(r.error.Spawn),
				status: "error",
			})
			return
		}
		if (!r.data.ok) {
			// A refused reword — a hook, a stopped rebase, a precondition the repo
			// doesn't meet — explains itself in its own output, and git::reword has
			// already put the repo back.
			showOutput({
				title: `Could not reword ${short}`,
				output: r.data.output,
				status: "error",
			})
			return
		}
		showOutput({
			title: `Reworded ${short}`,
			output: r.data.output,
			status: "ok",
		})
		// The reworded commit has a NEW hash, so the old selection points at
		// something that no longer exists on the branch. Select the rewritten tip.
		if (r.data.sha) {
			setSelectHash(r.data.sha)
		}
		refresh()
	}

	async function runBranchOp(
		label: { running: string; ok: string; error: string },
		op: BranchOp,
	) {
		const runId = beginRun(label)
		const r = await commands.branchOp(repo.path, op, runId)
		if (r.status !== "ok") {
			showOutput({
				title: label.error,
				output:
					"NonZero" in r.error ? r.error.NonZero.stderr : String(r.error.Spawn),
				status: "error",
			})
			return
		}
		// Reload either way: a refused checkout changed nothing, but a partial one
		// may have, and the displayed state must match reality.
		refresh()
	}

	function checkoutRef(ref: {
		name: string
		kind: "local" | "remote" | "tag"
	}) {
		const label = {
			running: `Checking out ${ref.name}…`,
			ok: `Checked out ${ref.name}`,
			error: `Could not check out ${ref.name}`,
		}
		if (ref.kind === "remote") {
			// Creates a local branch tracking it, which is what "checkout" means for
			// a remote-tracking ref.
			void runBranchOp(label, { kind: "CheckoutRemote", remote_ref: ref.name })
		} else if (ref.kind === "tag") {
			// A tag isn't a branch, so checking it out detaches HEAD.
			void runBranchOp(label, { kind: "CheckoutCommit", commit: ref.name })
		} else {
			void runBranchOp(label, { kind: "Checkout", target: ref.name })
		}
	}

	// One set of ref operations for both places a ref is right-clickable: the
	// sidebar list and the badges on commit rows.
	const refActions: RefActions = {
		onCheckout: checkoutRef,
		onCreateBranch: (startPoint) => setPrompt({ startPoint }),
		onDeleteRef: (ref, force) => setConfirmDelete({ ref, force }),
		onDiffRef: (ref) => {
			dismissOutput()
			// Compare THIS ref (branch or tag) against its base — so the clicked ref
			// must become the compare head. (Unlike onSelectRef, which nulls
			// activeBranch for tags because that path only browses history; here
			// activeBranch drives compareHead.)
			setActiveBranch(ref.name)
			setSelectHash(ref.tip)
			setCompareBase(null)
			setCompareMode(true)
		},
	}

	async function openTerminal() {
		// The stored command is the user's override; empty means auto-detect.
		let command: string | null = null
		try {
			const raw = getSetting("terminal-command")
			const value = raw === null ? "" : JSON.parse(raw)
			command = typeof value === "string" && value.trim() !== "" ? value : null
		} catch {
			command = null
		}
		const r = await commands.openTerminal(repo.path, command)
		if (r.status !== "ok") {
			// Silence would look like a broken button, so failures land in the same
			// panel every other command's output does.
			showOutput({
				title: "Could not open a terminal",
				output: `${r.error}\n\nSet a terminal command in Help (?) if your terminal isn't detected.`,
				status: "error",
			})
		}
	}

	// Stable identity so CommitDetail's load effect isn't re-triggered per render.
	// `p !== null` means a FILE was opened, which is new content for this panel.
	// A null path is a panel resetting (a commit selection clearing its diff), and
	// must not dismiss output — otherwise committing would instantly hide its own
	// result, since a successful commit selects the new commit programmatically.
	const handleFileDiff = useCallback(
		(d: string, p: string | null) => {
			if (p !== null) {
				dismissOutput()
			}
			setDiff(d)
			setDiffPath(p)
		},
		[dismissOutput],
	)

	// Stable identity so CommitRailway's selectHash effect isn't re-triggered
	// per render; only setSelectHash(null) itself should clear it.
	const clearSelectHash = useCallback(() => setSelectHash(null), [])

	return (
		<div className="workspace">
			<header className="workspace-header">
				<button
					type="button"
					className="btn btn-icon workspace-back"
					title="Back to repositories"
					aria-label="Back to repositories"
					onClick={onBack}
				>
					<CaretLeft />
				</button>
				<h1 className="workspace-name" title={repo.name}>
					{repo.name}
				</h1>
				{/* A segmented control, not a toggle button. The button showed the
				    state it was IN ("All branches") while clicking it did the
				    opposite — so the label read as the action to half the people who
				    saw it. Here both options are visible and the active one is
				    marked, which cannot be misread either way. */}
				<div
					className="workspace-segmented"
					role="group"
					aria-label="Which commits to show"
				>
					{(["all", "current"] as const).map((option) => (
						<button
							key={option}
							type="button"
							className={`workspace-segment ${scope === option ? "is-on" : ""}`}
							aria-pressed={scope === option}
							title={
								option === "all"
									? "Show commits from every branch"
									: "Show only the checked-out branch"
							}
							onClick={() => {
								if (scope === option) {
									return
								}
								setScope(option)
								setSelected(null)
								setDiff("")
								setDiffPath(null)
							}}
						>
							{option === "all" ? "All branches" : "Current branch"}
						</button>
					))}
				</div>
				{compareHead !== null && (
					<div className="workspace-compare">
						<button
							type="button"
							className={`workspace-scope ${compareMode ? "is-on" : ""}`}
							title={`Review only ${compareHead}'s changes vs a base branch`}
							onClick={() => setCompareMode((c) => !c)}
						>
							{compareMode ? (
								<>
									<GitBranch />
									{`Reviewing ${compareHead}`}
								</>
							) : (
								<>
									<GitDiff />
									Compare with base
								</>
							)}
						</button>
						{compareMode && (
							<>
								<span className="workspace-compare-vs">vs</span>
								<BranchPicker
									value={compareBase ?? ""}
									options={baseOptions}
									onChange={(b) => setCompareBase(b)}
									placeholder="base…"
								/>
								<button
									type="button"
									className="btn btn-icon workspace-compare-exit"
									title="Exit review"
									aria-label="Exit review"
									onClick={() => setCompareMode(false)}
								>
									<X />
								</button>
							</>
						)}
					</div>
				)}
				<span className="workspace-path" title={repo.path}>
					{repo.path}
				</span>
				{/* Git operations, each with its NAME on it. They were icon-only, which
				    meant the only way to learn what any of them did was to hover and
				    wait for a tooltip — for buttons that talk to a remote. */}
				<div className="workspace-git-actions" role="group" aria-label="Git">
					<button
						type="button"
						className="workspace-op"
						title="Fetch all remotes"
						aria-label="Fetch"
						onClick={() => setFetchOpen(true)}
					>
						<CloudArrowDown />
						Fetch
					</button>
					<button
						type="button"
						className="workspace-op workspace-sync"
						title={pullTitle}
						aria-label="Pull"
						onClick={() =>
							void runRemote(
								{ running: "Pulling…", ok: "Pulled", error: "Pull failed" },
								(runId) => commands.pull(repo.path, runId),
							)
						}
					>
						<ArrowDown />
						Pull
						{behind > 0 && (
							<span className="workspace-sync-count">{behind}</span>
						)}
					</button>
					<button
						type="button"
						className="workspace-op workspace-sync"
						title={pushTitle}
						aria-label="Push"
						onClick={() =>
							void runRemote(
								{ running: "Pushing…", ok: "Pushed", error: "Push failed" },
								(runId) => commands.push(repo.path, needsUpstream, runId),
							)
						}
					>
						<ArrowUp />
						Push
						{ahead > 0 && <span className="workspace-sync-count">{ahead}</span>}
					</button>
					<button
						type="button"
						className="workspace-op"
						title={`Merge another branch into ${currentBranch ?? "HEAD"}`}
						aria-label="Merge"
						onClick={() => setMergeOpen(true)}
					>
						<GitMerge />
						Merge
					</button>
					<button
						type="button"
						className="workspace-op"
						title="Stash the working tree, including untracked files"
						aria-label="Stash"
						onClick={() => setStashPrompt(true)}
					>
						<Stack />
						Stash
					</button>
					<button
						type="button"
						className="workspace-op"
						title="Create a branch at the checked-out commit"
						aria-label="New branch"
						onClick={() => setPrompt({ startPoint: "HEAD" })}
					>
						<GitBranch />
						New branch
					</button>
				</div>
				{/* Everything past here is the APP, not the repo — a divider rather
				    than one undifferentiated row of buttons. */}
				<div className="workspace-header-actions">
					<button
						type="button"
						className="btn btn-icon"
						title="Toggle sidebar"
						aria-label="Toggle sidebar"
						onClick={() => {
							const p = sidebarRef.current
							if (!p) return
							p.isCollapsed() ? p.expand() : p.collapse()
						}}
					>
						<SidebarSimple />
					</button>
					<button
						type="button"
						className="btn btn-icon"
						title={`Refresh (${refreshShortcutLabel(isMac)})`}
						aria-label="Refresh"
						onClick={refresh}
					>
						<ArrowClockwise />
					</button>
					<ThemeToggle />
				</div>
			</header>
			<PanelGroup
				direction="horizontal"
				autoSaveId="omni-ws-outer"
				storage={panelStorage}
				className="workspace-body"
			>
				<Panel
					ref={sidebarRef}
					id="sidebar"
					order={1}
					collapsible
					collapsedSize={0}
					defaultSize={18}
					minSize={12}
					maxSize={40}
					className="ws-pane"
				>
					<Sidebar
						{...refActions}
						onSelectStash={(stash) => {
							dismissOutput()
							setViewStash(stash)
						}}
						onApplyStash={(stash) => void runRestoreStash(stash, false)}
						onPopStash={(stash) => void runRestoreStash(stash, true)}
						activeStash={viewStash?.selector ?? null}
						refs={refs}
						worktrees={worktrees}
						stashes={stashes}
						error={refsError}
						activeHash={selected?.hash ?? null}
						onSelectRef={(ref) => {
							dismissOutput()
							setSelectHash(ref.tip)
							setActiveBranch(ref.kind === "tag" ? null : ref.name)
							setCompareMode(false)
							setCompareBase(null)
						}}
					/>
				</Panel>
				<PanelResizeHandle className="ws-resize ws-resize-v" />
				<Panel id="main" order={2} className="ws-pane">
					<PanelGroup
						direction="vertical"
						autoSaveId="omni-ws-main"
						storage={panelStorage}
					>
						<Panel defaultSize={55} minSize={20} className="ws-pane">
							<CommitRailway
								onCheckoutCommit={(hash) =>
									void runBranchOp(
										{
											running: `Checking out ${hash.slice(0, 7)}…`,
											ok: `Checked out ${hash.slice(0, 7)} (detached)`,
											error: "Could not check out that commit",
										},
										{ kind: "CheckoutCommit", commit: hash },
									)
								}
								onCreateBranch={(startPoint) => setPrompt({ startPoint })}
								onReset={(hash) => setResetTo(hash)}
								onReword={openReword}
								onCherryPick={(hashes) => {
									dismissOutput()
									setCherryPick(hashes)
								}}
								refActions={refActions}
								repoPath={repo.path}
								reloadToken={refreshKey}
								all={scope === "all"}
								selectedHash={selected?.hash ?? null}
								selectHash={selectHash}
								onSelect={(c) => {
									setViewStash(null)
									setSelected(c)
								}}
								onCommitClick={() => {
									setCompareMode(false)
									dismissOutput()
								}}
								onSelectHashConsumed={clearSelectHash}
								rootRef={railwayRootRef}
								onAdvance={() => filesRootRef.current?.focus()}
							/>
						</Panel>
						<PanelResizeHandle className="ws-resize ws-resize-h" />
						<Panel minSize={20} className="ws-pane">
							<PanelGroup
								direction="horizontal"
								autoSaveId="omni-ws-bottom"
								storage={panelStorage}
							>
								<Panel defaultSize={32} minSize={15} className="ws-pane">
									<div className={`ws-fill ${compareMode ? "is-compare" : ""}`}>
										{compareMode && compareHead !== null && compareBase ? (
											<CompareDetail
												repoPath={repo.path}
												base={compareBase}
												head={compareHead}
												// Only for the branch actually checked out: the
												// working tree is HEAD's, so folding it into a
												// comparison of a different branch would attribute
												// your local edits to a branch that has never seen
												// them.
												includeWorktree={compareHead === currentBranch}
												onFileDiff={handleFileDiff}
												ignoreWhitespace={ignoreWhitespace}
												forceText={forceText}
												filesRootRef={filesRootRef}
												onAdvanceFiles={() => diffRootRef.current?.focus()}
												onRetreatFiles={() => railwayRootRef.current?.focus()}
											/>
										) : viewStash !== null ? (
											<StashDetail
												repoPath={repo.path}
												stash={viewStash}
												onFileDiff={handleFileDiff}
												ignoreWhitespace={ignoreWhitespace}
												forceText={forceText}
												onApply={(st) => void runRestoreStash(st, false)}
												onPop={(st) => void runRestoreStash(st, true)}
												filesRootRef={filesRootRef}
												onAdvanceFiles={() => diffRootRef.current?.focus()}
												onRetreatFiles={() => railwayRootRef.current?.focus()}
											/>
										) : selected?.hash === WORKING_HASH ? (
											<WorkingCopyDetail
												reloadToken={refreshKey}
												repoPath={repo.path}
												onFileDiff={handleFileDiff}
												ignoreWhitespace={ignoreWhitespace}
												forceText={forceText}
												onMutated={refresh}
												onBeginRun={beginRun}
												onOutput={showOutput}
												onCommitAndPush={() =>
													void runRemote(
														{
															running: "Pushing…",
															ok: "Pushed",
															error: "Push failed",
														},
														(runId) =>
															commands.push(repo.path, needsUpstream, runId),
													)
												}
												onCommitted={(sha) => {
													// The working row vanishes the moment the tree is
													// clean, so leaving the selection on it would strand
													// the user on "No uncommitted changes.". Both
													// setStates land in one batch, so the railway
													// remounts under its new key already carrying the
													// select-hash and its load-until-found path picks
													// the brand-new commit.
													setSelectHash(sha)
													refresh()
												}}
												filesRootRef={filesRootRef}
												onAdvanceFiles={() => diffRootRef.current?.focus()}
												onRetreatFiles={() => railwayRootRef.current?.focus()}
											/>
										) : (
											<CommitDetail
												repoPath={repo.path}
												selectedCommit={selected}
												refActions={refActions}
												onFileDiff={handleFileDiff}
												ignoreWhitespace={ignoreWhitespace}
												forceText={forceText}
												filesRootRef={filesRootRef}
												onAdvanceFiles={() => diffRootRef.current?.focus()}
												onRetreatFiles={() => railwayRootRef.current?.focus()}
											/>
										)}
									</div>
								</Panel>
								<PanelResizeHandle className="ws-resize ws-resize-v" />
								<Panel minSize={20} className="ws-pane">
									{output !== null ? (
										<CommandOutput result={output} onClose={closeOutput} />
									) : (
										<DiffView
											diff={diff}
											path={diffPath}
											ignoreWhitespace={ignoreWhitespace}
											onToggleIgnoreWhitespace={() =>
												setIgnoreWhitespace((v) => !v)
											}
											onShowAsText={
												forceText ? undefined : () => setForceTextPath(diffPath)
											}
											rootRef={diffRootRef}
											onRetreat={() => filesRootRef.current?.focus()}
										/>
									)}
								</Panel>
							</PanelGroup>
						</Panel>
					</PanelGroup>
				</Panel>
			</PanelGroup>
			{paletteOpen && (
				<CommandPalette
					refs={[
						...(refs?.local ?? []).map((b) => b.name),
						...(refs?.remotes ?? []).map((r) => r.name),
						...(refs?.tags ?? []).map((t) => t.name),
					]}
					history={history}
					onRun={(input) => void runPaletteCommand(input)}
					onClose={() => setPaletteOpen(false)}
				/>
			)}
			<GitConsole
				entries={entries}
				open={consoleOpen}
				onToggle={() => setConsoleOpen((o) => !o)}
				onClear={clear}
				onOpenTerminal={() => void openTerminal()}
				onOpenHelp={() => setHelpOpen(true)}
			/>
			{helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
			<PromptDialog
				open={prompt !== null}
				message={
					prompt === null
						? ""
						: `New branch from ${prompt.startPoint.slice(0, 40)}`
				}
				placeholder="feature/my-change"
				confirmLabel="Create and switch"
				onCancel={() => setPrompt(null)}
				onConfirm={(name) => {
					const startPoint = prompt?.startPoint ?? "HEAD"
					setPrompt(null)
					void runBranchOp(
						{
							running: `Creating ${name}…`,
							ok: `Created ${name}`,
							error: `Could not create ${name}`,
						},
						{
							kind: "Create",
							name,
							start_point: startPoint,
							// Creating a branch you don't switch to is rarely what's wanted
							// from this menu, and switching is one fewer step.
							checkout: true,
						},
					)
				}}
			/>
			<MergeDialog
				open={mergeOpen}
				current={currentBranch}
				branches={baseOptions}
				onCancel={() => setMergeOpen(false)}
				onConfirm={(target, mode) => void runMerge(target, mode)}
			/>
			<FetchDialog
				open={fetchOpen}
				onCancel={() => setFetchOpen(false)}
				onConfirm={(mode) => {
					setFetchOpen(false)
					void runRemote(
						{ running: "Fetching…", ok: "Fetched", error: "Fetch failed" },
						(runId) => commands.fetch(repo.path, mode === "prune", runId),
					)
				}}
			/>
			<PromptDialog
				open={stashPrompt}
				message="Stash the working tree, including untracked files."
				confirmLabel="Stash"
				placeholder="Message (optional)"
				onCancel={() => setStashPrompt(false)}
				onConfirm={(message) => void runStashPush(message)}
			/>
			<CherryPickDialog
				open={cherryPick !== null}
				commits={cherryPick ?? []}
				branch={currentBranch}
				onCancel={() => setCherryPick(null)}
				onConfirm={(mode) => {
					const commits = cherryPick
					if (commits) {
						void runCherryPick(commits, mode)
					}
				}}
			/>
			<RewordDialog
				open={reword !== null}
				commit={reword?.hash ?? ""}
				original={reword?.original ?? null}
				isHead={reword?.isHead ?? false}
				loading={reword !== null && reword.original === null}
				onCancel={() => setReword(null)}
				onConfirm={(message) => {
					const hash = reword?.hash
					if (hash) {
						void runReword(hash, message)
					}
				}}
			/>
			<ResetDialog
				open={resetTo !== null}
				commit={resetTo ?? ""}
				branch={headBranch?.name ?? null}
				onCancel={() => setResetTo(null)}
				onConfirm={(mode) => {
					const commit = resetTo
					setResetTo(null)
					if (commit === null) {
						return
					}
					const short = commit.slice(0, 7)
					void (async () => {
						const label = {
							running: `Resetting to ${short}…`,
							ok: `Reset to ${short} (${mode.toLowerCase()})`,
							error: `Could not reset to ${short}`,
						}
						const runId = beginRun(label)
						const r = await commands.reset(repo.path, mode, commit, runId)
						if (r.status !== "ok") {
							showOutput({
								title: label.error,
								output:
									"NonZero" in r.error
										? r.error.NonZero.stderr
										: String(r.error.Spawn),
								status: "error",
							})
							return
						}
						refresh()
					})()
				}}
			/>
			<ConfirmDialog
				open={confirmDelete !== null}
				message={
					confirmDelete === null
						? ""
						: confirmDelete.ref.kind === "remote"
							? `Delete ${confirmDelete.ref.name} on the remote? This cannot be undone.`
							: confirmDelete.force
								? `Force-delete ${confirmDelete.ref.name}? Unmerged commits on it will be lost.`
								: `Delete ${confirmDelete.ref.name}?`
				}
				confirmLabel="Delete"
				onCancel={() => setConfirmDelete(null)}
				onConfirm={() => {
					if (confirmDelete === null) {
						return
					}
					const { ref, force } = confirmDelete
					setConfirmDelete(null)
					const label = {
						running: `Deleting ${ref.name}…`,
						ok: `Deleted ${ref.name}`,
						error: `Could not delete ${ref.name}`,
					}
					if (ref.kind === "remote") {
						// "origin/feature" splits into the remote and the branch it names.
						const slash = ref.name.indexOf("/")
						void runBranchOp(label, {
							kind: "DeleteRemote",
							remote: ref.name.slice(0, slash),
							branch: ref.name.slice(slash + 1),
						})
					} else {
						void runBranchOp(label, { kind: "Delete", name: ref.name, force })
					}
				}}
			/>
		</div>
	)
}
