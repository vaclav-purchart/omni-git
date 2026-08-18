import {
	ArrowCounterClockwise,
	Check,
	Minus,
	Plus,
	Trash,
	X,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import type { CommandResult } from "../console/CommandOutput"
import type { RunLabels } from "../console/useCommandStream"
import {
	commands,
	type FileChange,
	type GitError,
	type OperationAction,
	type RepoOperation,
	type Result,
	type WorkingSection,
} from "../ipc/bindings"
import { ConfirmDialog } from "../ui/ConfirmDialog"
import { ContextMenu, type MenuItem } from "../ui/ContextMenu"
import { usePersistentState } from "../ui/usePersistentState"
import { CommitBox } from "./CommitBox"
import "./CommitDetail.css"
import "./WorkingCopyDetail.css"
import { copyPathItem } from "./copyPathItem"
import { FileList, rowKey } from "./FileList"
import {
	rowsToKeys,
	type SelectionActions,
	selectionActions,
	selectionBySection,
	selectionSize,
	toggleRow,
} from "./fileSelection"
import { OperationBanner } from "./OperationBanner"
import { asWorkingSection } from "./workingSection"

type ActiveKey = { section: WorkingSection; path: string } | null

/**
 * The two top-level divisions of the panel.
 *
 * Named after what they mean for the commit being prepared rather than after
 * git's index — "staged" is the mechanism, "in this commit" is the consequence,
 * and the consequence is what you are deciding about.
 */
const CONFLICTED = "Needs resolving"
const IN_COMMIT = "Staged in this commit"
const NOT_IN_COMMIT = "Not in this commit"

export function WorkingCopyDetail({
	repoPath,
	onFileDiff,
	ignoreWhitespace,
	forceText = false,
	onMutated,
	onCommitted,
	onCommitAndPush,
	onBeginRun,
	onOutput,
	reloadToken = 0,
	filesRootRef,
	onAdvanceFiles,
	onRetreatFiles,
}: {
	repoPath: string
	onFileDiff: (diff: string, path: string | null) => void
	ignoreWhitespace: boolean
	// Re-read this file with `--text` (git called it binary). Per-file, owned by
	// the workspace.
	forceText?: boolean
	onMutated: () => void
	onCommitted?: (sha: string) => void
	onCommitAndPush?: () => void
	// Both reported up rather than handled here: the output panel must outlive
	// this component, which unmounts as soon as the selection moves off the
	// working row — including when a successful commit selects the new commit.
	onBeginRun?: (labels: RunLabels) => string
	onOutput?: (result: CommandResult) => void
	// Bumped instead of remounting this component: the remount cleared the file
	// sections and blanked the diff for a frame after every mutation, which is
	// what made the panel flash.
	reloadToken?: number
	filesRootRef?: React.RefObject<HTMLDivElement | null>
	onAdvanceFiles?: () => void
	onRetreatFiles?: () => void
}) {
	const [staged, setStaged] = useState<FileChange[]>([])
	const [unstaged, setUnstaged] = useState<FileChange[]>([])
	const [untracked, setUntracked] = useState<FileChange[]>([])
	// `null` means an unborn branch (no commits yet) — nothing to amend.
	const [head, setHead] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	// Separate from `error`: `error` is for LOAD failures (workingStatus) and
	// drives the full-panel early-return below. A failed mutation (stage/
	// unstage/discard) must not nuke the whole staging UI — it's rendered as
	// a dismissable inline banner instead, with the toolbar + file list still
	// visible underneath.
	const [actionError, setActionError] = useState<string | null>(null)
	const [activeKey, setActiveKey] = useState<ActiveKey>(null)
	const [confirm, setConfirm] = useState<{
		path: string
		untracked: boolean
	} | null>(null)
	// Group-level destructive actions get their own confirm, so its message can
	// name the whole group and its count.
	const [confirmGroup, setConfirmGroup] = useState<{
		kind: "discard-unstaged" | "clean-untracked"
		count: number
	} | null>(null)
	const [menu, setMenu] = useState<{
		pos: { x: number; y: number }
		items: MenuItem[]
	} | null>(null)
	// Multi-selection, as `section:path` keys. Deliberately separate from
	// `activeKey`: the active row is what the diff panel shows, and clicking
	// through a selection to read each file must not dismantle it.
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
	// Confirms a destructive action on a selection, which needs its own message
	// because it names a count that isn't a whole group.
	const [confirmSelection, setConfirmSelection] = useState<{
		kind: "discard" | "remove"
		paths: string[]
	} | null>(null)
	const [commitOpen, setCommitOpen] = usePersistentState(
		"commit-box-open",
		true,
	)
	const messageRef = useRef<HTMLTextAreaElement>(null)
	// Set when Cmd/Ctrl+Enter arrives while the commit box is collapsed: the
	// textarea doesn't exist yet, so the focus has to wait until the expanded
	// box has rendered.
	const pendingFocusRef = useRef(false)
	useEffect(() => {
		if (commitOpen && pendingFocusRef.current) {
			pendingFocusRef.current = false
			messageRef.current?.focus()
		}
	}, [commitOpen])
	// Guards against showing "No uncommitted changes." on the first frame,
	// before workingStatus has resolved for the first time.
	const [loaded, setLoaded] = useState(false)
	// What the repo is in the middle of. Read on the same schedule as the status,
	// since a conflict appears and clears through exactly the same events.
	const [operation, setOperation] = useState<RepoOperation | null>(null)
	const [opBusy, setOpBusy] = useState(false)
	// Bumped whenever the repo changes, so an in-flight workingStatus/
	// workingFileDiff request from a previous load can be detected and discarded.
	const genRef = useRef(0)
	// Bumped on every openFile call, so an earlier file click's slower fileDiff
	// response can't overwrite a later file click's result.
	const reqRef = useRef(0)
	// Held in a ref so the load effect does NOT depend on the callback's identity.
	// A parent that passes an inline `onFileDiff` would otherwise re-run this
	// effect every render, causing an infinite status-fetch loop.
	const onFileDiffRef = useRef(onFileDiff)
	useEffect(() => {
		onFileDiffRef.current = onFileDiff
	}, [onFileDiff])
	// Tracks whether this component instance is still mounted, so an
	// in-flight diff request that resolves after unmount (e.g. the user
	// switched to a different commit/node) can't overwrite the diff panel
	// the newly-mounted component just set.
	const aliveRef = useRef(true)
	useEffect(() => {
		return () => {
			aliveRef.current = false
		}
	}, [])
	// Mirrored so the load effect can reconcile the open file without depending
	// on it (which would re-run the fetch on every file click).
	const activeKeyRef = useRef<ActiveKey>(null)
	useEffect(() => {
		activeKeyRef.current = activeKey
	}, [activeKey])

	// Switching repo is the only case that should blank this panel. Everything
	// here is about the OLD repo and would be wrong to keep.
	useEffect(() => {
		setActiveKey(null)
		setStaged([])
		setUnstaged([])
		setUntracked([])
		setError(null)
		setActionError(null)
		setLoaded(false)
		onFileDiffRef.current("", null)
	}, [repoPath])

	// Load, and re-load in place whenever something changed the repo.
	//
	// Nothing is cleared first: this runs after every stage/unstage/commit and on
	// every watcher event, and emptying the sections (or blanking the diff) for
	// the duration of a fetch is exactly what made the panel flash. Unchanged
	// files produce no visible change; the open file's diff is re-read rather
	// than dropped.
	useEffect(() => {
		genRef.current += 1
		const gen = genRef.current
		commands.workingStatus(repoPath).then((r) => {
			if (genRef.current !== gen) {
				return
			}
			if (r.status === "ok") {
				setStaged(r.data.staged)
				setUnstaged(r.data.unstaged)
				setUntracked(r.data.untracked)
				setHead(r.data.head)
				setError(null)
				setActionError(null)
				reconcileOpenFile(r.data)
			} else {
				setError(
					"NonZero" in r.error
						? r.error.NonZero.stderr
						: "Failed to load working status",
				)
			}
			setLoaded(true)
		})
		commands.repoOperation(repoPath).then((r) => {
			if (genRef.current !== gen) {
				return
			}
			setOperation(r.status === "ok" ? r.data : null)
		})
	}, [repoPath, reloadToken])

	async function runOperationAction(action: OperationAction) {
		const kind = operation?.kind
		if (!kind) {
			return
		}
		setOpBusy(true)
		const runId =
			onBeginRun?.({
				running: `Running ${kind} ${action.toLowerCase()}…`,
				ok: `${kind} ${action.toLowerCase()} done`,
				error: `${kind} ${action.toLowerCase()} failed`,
			}) ?? ""
		const r = await commands.operationAction(repoPath, kind, action, runId)
		setOpBusy(false)
		if (r.status !== "ok") {
			setActionError(
				"NonZero" in r.error ? r.error.NonZero.stderr : "Operation failed",
			)
			onMutated()
			return
		}
		// A refusal — usually "you still have unmerged files" — names the files
		// still in the way, so it goes to the output panel rather than being
		// flattened into a one-line banner.
		onOutput?.({
			title: r.data.ok
				? `${kind} ${action.toLowerCase()} done`
				: `Could not ${action.toLowerCase()} the ${kind.toLowerCase()}`,
			output: r.data.output,
			status: r.data.ok ? "ok" : "error",
		})
		onMutated()
	}

	/**
	 * Keeps the open file open across a reload.
	 *
	 * Staging a file MOVES it between sections, so the previous key stops
	 * matching — following it to its new section means you keep looking at the
	 * same file's diff instead of the panel going blank under you. Only a file
	 * that has genuinely gone (committed, discarded) clears the diff.
	 */
	function reconcileOpenFile(data: {
		staged: FileChange[]
		unstaged: FileChange[]
		untracked: FileChange[]
	}) {
		const sections: Array<[WorkingSection, FileChange[]]> = [
			["Staged", data.staged],
			["Unstaged", data.unstaged],
			["Untracked", data.untracked],
		]

		// The user acted on the row they were looking at: take whatever moved up
		// into its place, or the new last row if it was at the end.
		const pending = pendingSelectRef.current
		if (pending !== null) {
			pendingSelectRef.current = null
			const files =
				sections.find(([section]) => section === pending.section)?.[1] ?? []
			const next = files[pending.index] ?? files[pending.index - 1]
			if (next !== undefined) {
				void openFile(pending.section, next.path)
			} else {
				// That section is empty now; nothing sensible to advance to.
				setActiveKey(null)
				onFileDiffRef.current("", null)
			}
			return
		}

		const key = activeKeyRef.current
		if (key === null) {
			return
		}
		const stillThere = sections.find(([section]) => section === key.section)
		if (stillThere?.[1].some((f) => f.path === key.path)) {
			void openFile(key.section, key.path)
			return
		}
		const moved = sections.find(([, files]) =>
			files.some((f) => f.path === key.path),
		)
		if (moved !== undefined) {
			void openFile(moved[0], key.path)
			return
		}
		setActiveKey(null)
		onFileDiffRef.current("", null)
	}

	async function openFile(section: WorkingSection, path: string) {
		const gen = genRef.current
		reqRef.current += 1
		const req = reqRef.current
		setActiveKey({ section, path })
		const r = await commands.workingFileDiff(
			repoPath,
			path,
			section,
			ignoreWhitespace,
			forceText,
		)
		if (genRef.current !== gen || reqRef.current !== req) {
			return
		}
		if (!aliveRef.current) {
			return
		}
		if (r.status !== "ok") {
			// An empty pane is indistinguishable from a file with no changes, which is
			// how a conflicted file whose diff request was rejected looked like
			// nothing at all. Report it in the inline banner and leave the pane empty.
			setActionError(
				"NonZero" in r.error
					? r.error.NonZero.stderr
					: `Could not load the diff for ${path}`,
			)
			onFileDiffRef.current("", path)
			return
		}
		onFileDiffRef.current(r.data, path)
	}

	/**
	 * Where to put the selection after the next reload, set when the user acts on
	 * the row they're currently looking at.
	 *
	 * Working down a list of changes, staging the file you just reviewed should
	 * leave you on the NEXT one rather than following the file into its new
	 * section. Only when it was the active row: acting on some other row while
	 * reading this one shouldn't yank the diff away.
	 */
	const pendingSelectRef = useRef<{
		section: WorkingSection
		index: number
	} | null>(null)

	/** Runs a per-file action, remembering where the selection should land. */
	function runFileMutation(
		section: WorkingSection,
		path: string,
		p: Promise<Result<null, GitError>>,
	) {
		const active = activeKeyRef.current
		if (active !== null && active.section === section && active.path === path) {
			const index = sectionFiles(section).findIndex((f) => f.path === path)
			if (index >= 0) {
				pendingSelectRef.current = { section, index }
			}
		}
		void runMutation(p)
	}

	function sectionFiles(section: WorkingSection): FileChange[] {
		switch (section) {
			case "Staged":
				return staged
			case "Unstaged":
				return unstaged
			default:
				return untracked
		}
	}

	// Unmerged paths, as file rows. Their status is "U" — git's own code for
	// unmerged — rather than the M/A/D the other sections use, because the point
	// is that the file is in neither state yet.
	const conflictedPaths = new Set(operation?.conflicts ?? [])
	const conflictedFiles: FileChange[] = (operation?.conflicts ?? []).map(
		(path) => ({ status: "U", path }),
	)
	// A conflicted path also appears in the ordinary status output (as `UU`), so
	// without this it would be listed twice — once as the thing to fix and once as
	// an ordinary edit.
	const notConflicted = (f: FileChange) => !conflictedPaths.has(f.path)
	const stagedRows = staged.filter(notConflicted)
	const unstagedRows = unstaged.filter(notConflicted)

	// Recomputed from the current rows every render rather than stored: a mutation
	// MOVES paths between sections, and a stored list would keep naming a file by
	// where it used to be.
	const selectionRows = [
		{ key: "Staged" as const, paths: staged.map((f) => f.path) },
		{ key: "Unstaged" as const, paths: unstaged.map((f) => f.path) },
		{ key: "Untracked" as const, paths: untracked.map((f) => f.path) },
	]
	const selection = selectionBySection(selected, selectionRows)
	const selectedCount = selectionSize(selection)
	const actions = selectionActions(selection)
	// One row selected is just the active row by another name; the multi-select UI
	// only earns its space once it is acting on more than the obvious.
	const hasMultiSelection = selectedCount > 1

	function clearSelection() {
		setSelected(new Set())
	}

	/**
	 * Runs an action on the whole selection, then drops it.
	 *
	 * Dropped because the rows it named have just moved or gone: keeping it would
	 * leave a selection highlighting whatever now occupies those positions.
	 */
	function runSelectionMutation(p: Promise<Result<null, GitError>>) {
		clearSelection()
		void runMutation(p)
	}

	function stageSelection() {
		runSelectionMutation(commands.stagePaths(repoPath, actions.stage))
	}
	function unstageSelection() {
		runSelectionMutation(commands.unstagePaths(repoPath, actions.unstage))
	}

	/** The actions offered for a selection, as menu items. */
	function selectionMenuItems(a: SelectionActions): MenuItem[] {
		const items: MenuItem[] = []
		if (a.stage.length > 0) {
			items.push({
				type: "item",
				label: `Stage ${a.stage.length} files`,
				onClick: stageSelection,
			})
		}
		if (a.unstage.length > 0) {
			items.push({
				type: "item",
				label: `Unstage ${a.unstage.length} files`,
				onClick: unstageSelection,
			})
		}
		if (a.discard.length > 0) {
			items.push({
				type: "item",
				label: `Discard ${a.discard.length} files…`,
				danger: true,
				onClick: () =>
					setConfirmSelection({ kind: "discard", paths: a.discard }),
			})
		}
		if (a.remove.length > 0) {
			items.push({
				type: "item",
				label: `Delete ${a.remove.length} files…`,
				danger: true,
				onClick: () => setConfirmSelection({ kind: "remove", paths: a.remove }),
			})
		}
		items.push({ type: "separator" })
		items.push({
			type: "item",
			label: "Copy Paths To Clipboard",
			onClick: () => {
				const paths = [
					...selection.Staged,
					...selection.Unstaged,
					...selection.Untracked,
				]
				navigator.clipboard?.writeText(paths.join("\n")).catch(() => {})
			},
		})
		return items
	}

	async function runMutation(p: Promise<Result<null, GitError>>) {
		setActionError(null)
		const r = await p
		if (r.status === "ok") {
			onMutated()
		} else {
			setActionError(
				"NonZero" in r.error ? r.error.NonZero.stderr : "Operation failed",
			)
		}
	}

	// Re-fetch the open file's diff when the whitespace mode flips.
	useEffect(() => {
		if (activeKey !== null) {
			void openFile(activeKey.section, activeKey.path)
		}
	}, [ignoreWhitespace, forceText])

	// Section-aware: mirrors the wired Stage/Unstage/Discard/Remove actions
	// already available as inline row buttons (`renderRowActions` below), plus
	// Copy Path; everything else is scaffolded as disabled WIP for now.
	function buildWorkingFileMenu(file: FileChange, section: string): MenuItem[] {
		const copyPath = copyPathItem(file.path)
		switch (section as WorkingSection) {
			case "Staged":
				return [
					{
						type: "item",
						label: "Unstage",
						onClick: () =>
							runFileMutation(
								"Staged",
								file.path,
								commands.unstageFile(repoPath, file.path),
							),
					},
					copyPath,
					{ type: "separator" },
					{ type: "item", label: "Show In Finder", wip: true },
					{ type: "item", label: "Open", wip: true },
				]
			case "Unstaged":
				return [
					{
						type: "item",
						label: "Stage",
						onClick: () =>
							runFileMutation(
								"Unstaged",
								file.path,
								commands.stageFile(repoPath, file.path),
							),
					},
					{
						type: "item",
						label: "Discard…",
						danger: true,
						onClick: () => setConfirm({ path: file.path, untracked: false }),
					},
					copyPath,
					{ type: "separator" },
					{ type: "item", label: "Show In Finder", wip: true },
					{ type: "item", label: "Open", wip: true },
				]
			case "Untracked":
				return [
					{
						type: "item",
						label: "Stage",
						onClick: () =>
							runFileMutation(
								"Untracked",
								file.path,
								commands.stageFile(repoPath, file.path),
							),
					},
					{
						type: "item",
						label: "Remove…",
						danger: true,
						onClick: () => setConfirm({ path: file.path, untracked: true }),
					},
					copyPath,
					{ type: "separator" },
					{ type: "item", label: "Add to .gitignore", wip: true },
					{ type: "item", label: "Show In Finder", wip: true },
				]
			default:
				return [copyPath]
		}
	}

	if (error !== null) {
		return <div className="detail-empty">{error}</div>
	}
	if (
		loaded &&
		staged.length === 0 &&
		unstaged.length === 0 &&
		untracked.length === 0
	) {
		return <div className="detail-empty">No uncommitted changes.</div>
	}
	if (!loaded) {
		return <div className="detail-empty" />
	}

	return (
		<div
			className="detail-root"
			// Keyboard escalation: Cmd/Ctrl+Enter anywhere in the working panel
			// jumps to the commit message box (expanding it if collapsed). Inside
			// the box itself the same chord commits — see CommitBox.
			onKeyDown={(e) => {
				if (
					(e.metaKey || e.ctrlKey) &&
					e.key === "Enter" &&
					e.target !== messageRef.current
				) {
					e.preventDefault()
					if (commitOpen) {
						messageRef.current?.focus()
					} else {
						pendingFocusRef.current = true
						setCommitOpen(true)
					}
				}
			}}
		>
			{actionError !== null && (
				<div className="wc-action-error" role="alert">
					<span className="wc-action-error-message">{actionError}</span>
					<button
						type="button"
						className="wc-action-error-dismiss"
						aria-label="Dismiss"
						onClick={() => setActionError(null)}
					>
						<X />
					</button>
				</div>
			)}
			{operation !== null && (
				<OperationBanner
					operation={operation}
					busy={opBusy}
					onAction={(action) => void runOperationAction(action)}
				/>
			)}
			<FileList
				ariaLabel="Uncommitted changes"
				selectedKeys={selected}
				onToggleSelect={(section, path) =>
					setSelected((cur) => toggleRow(cur, section, path))
				}
				onSelectRange={(rows) => setSelected(rowsToKeys(rows))}
				renderSectionActions={(section, files) => {
					if (files.length === 0) {
						return null
					}
					const n = files.length
					const plural = n === 1 ? "" : "s"
					switch (section as WorkingSection) {
						case "Staged":
							return (
								<button
									type="button"
									className="wc-group-btn"
									title={`Unstage all ${n} staged file${plural}`}
									aria-label={`Unstage all ${n} staged files`}
									onClick={() => runMutation(commands.unstageAll(repoPath))}
								>
									<Minus />
									Unstage {n}
								</button>
							)
						case "Unstaged":
							return (
								<>
									<button
										type="button"
										className="wc-group-btn"
										title={`Stage all ${n} unstaged file${plural}`}
										aria-label={`Stage all ${n} unstaged files`}
										onClick={() => runMutation(commands.stageTracked(repoPath))}
									>
										<Plus />
										Stage {n}
									</button>
									<button
										type="button"
										className="wc-group-btn wc-group-danger"
										title={`Discard all ${n} unstaged change${plural}`}
										aria-label={`Discard all ${n} unstaged changes`}
										onClick={() =>
											setConfirmGroup({ kind: "discard-unstaged", count: n })
										}
									>
										<ArrowCounterClockwise />
										Discard {n}
									</button>
								</>
							)
						default:
							return (
								<>
									<button
										type="button"
										className="wc-group-btn"
										title={`Stage all ${n} untracked file${plural}`}
										aria-label={`Stage all ${n} untracked files`}
										onClick={() =>
											runMutation(
												commands.stagePaths(
													repoPath,
													files.map((f) => f.path),
												),
											)
										}
									>
										<Plus />
										Stage {n}
									</button>
									<button
										type="button"
										className="wc-group-btn wc-group-danger"
										title={`Delete all ${n} untracked file${plural}`}
										aria-label={`Delete all ${n} untracked files`}
										onClick={() =>
											setConfirmGroup({ kind: "clean-untracked", count: n })
										}
									>
										<Trash />
										Delete {n}
									</button>
								</>
							)
					}
				}}
				toolbar={
					// While rows are selected the toolbar becomes SELECTION-scoped
					// rather than growing a second bar above itself. Two rows of
					// stage buttons with different scopes — "Stage 4" over "Stage
					// all" — is the confusing part, not the buttons themselves.
					hasMultiSelection ? (
						<>
							<span className="wc-selection-count">
								{selectedCount} selected
							</span>
							{actions.stage.length > 0 && (
								<button
									type="button"
									className="wc-toolbar-btn"
									onClick={stageSelection}
								>
									<Plus />
									Stage {actions.stage.length}
								</button>
							)}
							{actions.unstage.length > 0 && (
								<button
									type="button"
									className="wc-toolbar-btn"
									onClick={unstageSelection}
								>
									<Minus />
									Unstage {actions.unstage.length}
								</button>
							)}
							{actions.discard.length > 0 && (
								<button
									type="button"
									className="wc-toolbar-btn is-danger"
									onClick={() =>
										setConfirmSelection({
											kind: "discard",
											paths: actions.discard,
										})
									}
								>
									<ArrowCounterClockwise />
									Discard {actions.discard.length}
								</button>
							)}
							{actions.remove.length > 0 && (
								<button
									type="button"
									className="wc-toolbar-btn is-danger"
									onClick={() =>
										setConfirmSelection({
											kind: "remove",
											paths: actions.remove,
										})
									}
								>
									<Trash />
									Delete {actions.remove.length}
								</button>
							)}
							<button
								type="button"
								className="wc-selection-clear"
								aria-label="Clear selection"
								title="Clear selection"
								onClick={clearSelection}
							>
								<X />
							</button>
						</>
					) : (
						<>
							<button
								type="button"
								className="wc-toolbar-btn"
								disabled={unstaged.length + untracked.length === 0}
								onClick={() => runMutation(commands.stageAll(repoPath))}
							>
								<Plus />
								Stage all
							</button>
							<button
								type="button"
								className="wc-toolbar-btn"
								disabled={staged.length === 0}
								onClick={() => runMutation(commands.unstageAll(repoPath))}
							>
								<Minus />
								Unstage all
							</button>
						</>
					)
				}
				sections={[
					// Conflicts lead, in a division of their own: nothing else in the
					// panel can proceed until they are gone, so they are not a subtype of
					// "in the commit or not" — they are what you have to deal with first.
					{
						key: "Conflicted" satisfies WorkingSection,
						label: "Conflicted",
						files: conflictedFiles,
						group: CONFLICTED,
					},
					// The two divisions that decide what a commit is. Staged/unstaged/
					// untracked are subtypes of "is it in the commit or not", and reading
					// them as three peers is what made the panel hard to scan.
					{
						key: "Staged" satisfies WorkingSection,
						label: "Staged",
						files: stagedRows,
						group: IN_COMMIT,
					},
					{
						key: "Unstaged" satisfies WorkingSection,
						label: "Unstaged",
						files: unstagedRows,
						group: NOT_IN_COMMIT,
					},
					{
						key: "Untracked" satisfies WorkingSection,
						label: "Untracked",
						files: untracked,
						group: NOT_IN_COMMIT,
					},
				]}
				renderGroupActions={(group, files) =>
					group === NOT_IN_COMMIT && files.length > 0 ? (
						<button
							type="button"
							className="wc-group-btn"
							title={`Stage all ${files.length} files not in the commit`}
							aria-label={`Stage all ${files.length} files not in the commit`}
							onClick={() => runMutation(commands.stageAll(repoPath))}
						>
							<Plus />
							Stage {files.length}
						</button>
					) : null
				}
				activeKey={activeKey}
				onOpen={(section, path) => {
					// A plain click REPLACES the selection with just this row, as it
					// does in every list. Not cleared to empty: the clicked row has to
					// be IN the selection for a following Cmd/Ctrl+click to make it
					// two, and leaving the old selection standing would apply the next
					// action to rows the user thought they had moved off.
					setSelected(new Set([rowKey(section, path)]))
					const known = asWorkingSection(section)
					if (known === null) {
						// Unreachable: every section key below is checked against
						// WorkingSection at its declaration.
						return
					}
					void openFile(known, path)
				}}
				onRowContextMenu={(f, section, e) => {
					e.preventDefault()
					// Right-clicking INSIDE a selection acts on the whole thing; on a row
					// outside it, the selection isn't what was aimed at, so the row's own
					// menu is what should open.
					const inSelection = selected.has(rowKey(section, f.path))
					setMenu({
						pos: { x: e.clientX, y: e.clientY },
						items:
							hasMultiSelection && inSelection
								? selectionMenuItems(actions)
								: buildWorkingFileMenu(f, section),
					})
				}}
				rootRef={filesRootRef}
				onAdvance={onAdvanceFiles}
				onRetreat={onRetreatFiles}
				renderRowActions={(f, section) =>
					section === "Conflicted" ? (
						<span className="wc-file-actions">
							<button
								type="button"
								className="wc-action-btn"
								// `git add` on an unmerged path is exactly what "resolved"
								// means to git — there is no separate resolve command.
								title="Mark resolved (stage it)"
								onClick={() =>
									runFileMutation(
										"Unstaged",
										f.path,
										commands.stageFile(repoPath, f.path),
									)
								}
							>
								<Check />
								Mark resolved
							</button>
						</span>
					) : (
						<span className="wc-file-actions">
							{section === "Staged" && (
								<button
									type="button"
									className="wc-action-btn"
									onClick={(e) => {
										e.stopPropagation()
										runFileMutation(
											"Staged",
											f.path,
											commands.unstageFile(repoPath, f.path),
										)
									}}
								>
									<Minus />
									Unstage
								</button>
							)}
							{section === "Unstaged" && (
								<>
									<button
										type="button"
										className="wc-action-btn"
										onClick={(e) => {
											e.stopPropagation()
											runFileMutation(
												"Unstaged",
												f.path,
												commands.stageFile(repoPath, f.path),
											)
										}}
									>
										<Plus />
										Stage
									</button>
									<button
										type="button"
										className="wc-action-btn wc-action-danger"
										onClick={(e) => {
											e.stopPropagation()
											setConfirm({ path: f.path, untracked: false })
										}}
									>
										<ArrowCounterClockwise />
										Discard
									</button>
								</>
							)}
							{section === "Untracked" && (
								<>
									<button
										type="button"
										className="wc-action-btn"
										onClick={(e) => {
											e.stopPropagation()
											runFileMutation(
												"Untracked",
												f.path,
												commands.stageFile(repoPath, f.path),
											)
										}}
									>
										<Plus />
										Stage
									</button>
									<button
										type="button"
										className="wc-action-btn wc-action-danger"
										onClick={(e) => {
											e.stopPropagation()
											setConfirm({ path: f.path, untracked: true })
										}}
									>
										<Trash />
										Remove
									</button>
								</>
							)}
						</span>
					)
				}
			/>
			<CommitBox
				repoPath={repoPath}
				stagedCount={staged.length}
				canAmend={head !== null}
				open={commitOpen}
				onToggleOpen={setCommitOpen}
				onCommitted={(sha) => onCommitted?.(sha)}
				onCommitAndPush={onCommitAndPush}
				onBeginRun={(labels) => onBeginRun?.(labels) ?? ""}
				onOutput={(result) => onOutput?.(result)}
				boxRef={messageRef}
			/>
			{menu && (
				<ContextMenu
					items={menu.items}
					position={menu.pos}
					onClose={() => setMenu(null)}
				/>
			)}
			<ConfirmDialog
				open={confirmSelection !== null}
				message={
					confirmSelection === null
						? ""
						: confirmSelection.kind === "discard"
							? `Discard changes to ${confirmSelection.paths.length} selected file${
									confirmSelection.paths.length === 1 ? "" : "s"
								}? This cannot be undone.`
							: `Delete ${confirmSelection.paths.length} selected untracked file${
									confirmSelection.paths.length === 1 ? "" : "s"
								}? This cannot be undone.`
				}
				confirmLabel={
					confirmSelection?.kind === "remove" ? "Delete" : "Discard"
				}
				onCancel={() => setConfirmSelection(null)}
				onConfirm={() => {
					if (confirmSelection === null) {
						return
					}
					const { kind, paths } = confirmSelection
					setConfirmSelection(null)
					runSelectionMutation(
						kind === "discard"
							? commands.discardPaths(repoPath, paths)
							: commands.cleanPaths(repoPath, paths),
					)
				}}
			/>
			<ConfirmDialog
				open={confirmGroup !== null}
				message={
					confirmGroup === null
						? ""
						: confirmGroup.kind === "discard-unstaged"
							? `Discard all ${confirmGroup.count} unstaged change${
									confirmGroup.count === 1 ? "" : "s"
								}? Staged changes and untracked files are kept. This cannot be undone.`
							: `Delete all ${confirmGroup.count} untracked file${
									confirmGroup.count === 1 ? "" : "s"
								}? This cannot be undone.`
				}
				confirmLabel={
					confirmGroup?.kind === "clean-untracked" ? "Delete" : "Discard"
				}
				onCancel={() => setConfirmGroup(null)}
				onConfirm={() => {
					if (confirmGroup === null) {
						return
					}
					const kind = confirmGroup.kind
					setConfirmGroup(null)
					void runMutation(
						kind === "discard-unstaged"
							? commands.discardAllUnstaged(repoPath)
							: commands.cleanUntracked(repoPath),
					)
				}}
			/>
			<ConfirmDialog
				open={confirm !== null}
				message={
					confirm === null
						? ""
						: confirm.untracked
							? `Delete untracked file "${confirm.path}"? This cannot be undone.`
							: `Discard changes to "${confirm.path}"? This cannot be undone.`
				}
				confirmLabel={confirm?.untracked ? "Delete" : "Discard"}
				onCancel={() => setConfirm(null)}
				onConfirm={() => {
					if (confirm !== null) {
						const c = confirm
						setConfirm(null)
						// Discarding removes the row too, so the selection should advance
						// the same way staging does.
						runFileMutation(
							c.untracked ? "Untracked" : "Unstaged",
							c.path,
							commands.discardFile(repoPath, c.path, c.untracked),
						)
					}
				}}
			/>
		</div>
	)
}
