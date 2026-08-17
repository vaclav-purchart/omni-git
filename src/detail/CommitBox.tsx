import {
	ArrowUp,
	CaretDown,
	CaretRight,
	Check,
	ClockCounterClockwise,
	MagnifyingGlass,
	X,
} from "@phosphor-icons/react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CommandResult } from "../console/CommandOutput"
import type { RunLabels } from "../console/useCommandStream"
import { commands } from "../ipc/bindings"
import { usePersistentState } from "../ui/usePersistentState"
import "./CommitBox.css"
import { NO_AUTOCORRECT } from "../ui/textInput"
import { commitShortcutLabel, isMacPlatform } from "../workspace/shortcuts"

// How many recent messages the recall list offers. Larger than fits on screen
// on purpose — the list scrolls and is searchable.
const RECALL_LIMIT = 50

export function CommitBox({
	repoPath,
	stagedCount,
	canAmend,
	onCommitted,
	onCommitAndPush,
	onBeginRun,
	onOutput,
	open,
	onToggleOpen,
	boxRef,
}: {
	repoPath: string
	stagedCount: number
	canAmend: boolean
	onCommitted: (sha: string) => void
	// Push straight after a successful commit. Absent when there's nothing to push
	// to (no remote configured), so the button simply isn't offered.
	onCommitAndPush?: () => void
	// Starts a streamed run in the workspace-owned output panel and returns the
	// id to correlate it. Output must NOT be held in here: this subtree is keyed
	// on refreshKey and a commit trips the FS watcher, so local state is wiped
	// mid-command — which is also why the panel finalises itself from the
	// `commandDone` event rather than from our return value.
	onBeginRun: (labels: RunLabels) => string
	// For failures that never produced a stream at all (git couldn't be spawned).
	onOutput: (result: CommandResult) => void
	// Collapsed state is owned by the parent so the Cmd/Ctrl+Enter shortcut can
	// expand the box and then focus the textarea it just rendered.
	open: boolean
	onToggleOpen: (open: boolean) => void
	boxRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
	// The draft CANNOT be plain useState: WorkingCopyDetail is keyed on
	// refreshKey, so it remounts on every refresh — including watcher-driven
	// ones the user didn't trigger — which would silently wipe a message
	// mid-typing. Persisting it per repo survives the remount (and, as a
	// bonus, app relaunch).
	const [message, setMessage] = usePersistentState(
		`commit-draft:${repoPath}`,
		"",
	)
	const [amend, setAmend] = useState(false)
	const [busy, setBusy] = useState(false)
	const [recall, setRecall] = useState<string[] | null>(null)
	const [recallQuery, setRecallQuery] = useState("")
	const [recallIndex, setRecallIndex] = useState(0)
	const ownRef = useRef<HTMLTextAreaElement>(null)
	const textareaRef = boxRef ?? ownRef
	const recallSearchRef = useRef<HTMLInputElement>(null)
	const recallListRef = useRef<HTMLDivElement>(null)
	// The draft that was in the box before "Amend" replaced it with HEAD's
	// message, so unticking can put it back.
	const preAmendRef = useRef<string>("")
	const aliveRef = useRef(true)
	useEffect(() => {
		return () => {
			aliveRef.current = false
		}
	}, [])

	// Auto-grow: start compact and grow with the content up to a CSS max-height,
	// so an empty box costs almost no vertical space in the panel.
	useEffect(() => {
		const el = textareaRef.current
		if (el === null || !open) {
			return
		}
		el.style.height = "auto"
		el.style.height = `${el.scrollHeight}px`
	}, [message, open])

	const matches = useMemo(() => {
		if (recall === null) {
			return []
		}
		const q = recallQuery.trim().toLowerCase()
		return q === "" ? recall : recall.filter((m) => m.toLowerCase().includes(q))
	}, [recall, recallQuery])

	// Land in the search box as soon as the list opens: with a long history,
	// typing to narrow beats scrolling. An effect (not a rAF callback) so the
	// focus is deterministic — the arrow/Enter/Escape handlers live on the
	// recall container and only fire if focus is actually inside it.
	const recallOpen = recall !== null
	useEffect(() => {
		if (recallOpen) {
			recallSearchRef.current?.focus()
		}
	}, [recallOpen])

	// Keep the highlight inside the (possibly shrunken) match list.
	useEffect(() => {
		setRecallIndex((i) => (i >= matches.length ? 0 : i))
	}, [matches.length])

	// Follow the keyboard highlight when it moves out of view.
	useEffect(() => {
		recallListRef.current
			?.querySelector<HTMLElement>(".commitbox-recall-item.is-active")
			?.scrollIntoView({ block: "nearest" })
	}, [recallIndex])

	const trimmed = message.trim()
	const canCommit =
		trimmed !== "" && (stagedCount > 0 || amend) && !busy && !isTooLong(message)

	async function toggleAmend(next: boolean) {
		setAmend(next)
		if (next) {
			preAmendRef.current = message
			const r = await commands.headCommitMessage(repoPath)
			if (!aliveRef.current) {
				return
			}
			if (r.status === "ok" && r.data !== null) {
				setMessage(r.data)
			}
		} else {
			setMessage(preAmendRef.current)
		}
	}

	function closeRecall() {
		setRecall(null)
		setRecallQuery("")
		setRecallIndex(0)
	}

	async function toggleRecall() {
		if (recall !== null) {
			closeRecall()
			return
		}
		const r = await commands.recentCommitMessages(repoPath, RECALL_LIMIT)
		if (!aliveRef.current) {
			return
		}
		setRecall(r.status === "ok" ? r.data : [])
		setRecallIndex(0)
	}

	function pick(m: string) {
		setMessage(m)
		closeRecall()
		textareaRef.current?.focus()
	}

	function onRecallKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault()
			closeRecall()
			textareaRef.current?.focus()
		} else if (e.key === "ArrowDown") {
			e.preventDefault()
			setRecallIndex((i) =>
				matches.length === 0 ? 0 : (i + 1) % matches.length,
			)
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			setRecallIndex((i) =>
				matches.length === 0 ? 0 : (i - 1 + matches.length) % matches.length,
			)
		} else if (e.key === "Enter") {
			e.preventDefault()
			const m = matches[recallIndex]
			if (m !== undefined) {
				pick(m)
			}
		}
	}

	async function submit(alsoPush = false) {
		if (!canCommit) {
			return
		}
		setBusy(true)
		// Opens the output panel immediately, so a slow hook is visibly working
		// instead of just spinning the cursor. The panel is driven by streamed
		// events from here on — we don't feed it the result.
		const runId = onBeginRun(
			amend
				? { running: "Amending…", ok: "Amended", error: "Amend rejected" }
				: { running: "Committing…", ok: "Committed", error: "Commit rejected" },
		)
		const r = await commands.commit(repoPath, message, amend, runId)
		// Only LOCAL state needs the alive guard. The parent callbacks below go to
		// the workspace, which outlives us — and must still run if we were
		// unmounted mid-commit (a hook that stashes trips the watcher), or a
		// successful commit would never get selected.
		if (aliveRef.current) {
			setBusy(false)
		}
		if (r.status !== "ok") {
			// Never streamed — no CommandDone will arrive, so report it directly.
			onOutput({
				title: "Could not run git commit",
				output: "NonZero" in r.error ? r.error.NonZero.stderr : String(r.error),
				status: "error",
			})
			return
		}
		const outcome = r.data
		if (!outcome.ok || outcome.sha === null) {
			// A hook rejection. The draft stays exactly as typed so the user can
			// fix the problem and retry without retyping. The streamed panel has
			// already shown why.
			return
		}
		if (aliveRef.current) {
			setMessage("")
			setAmend(false)
			closeRecall()
		}
		onCommitted(outcome.sha)
		// Only after the commit actually succeeded — pushing a failed commit would
		// push whatever was there before, which is not what the button says.
		if (alsoPush) {
			onCommitAndPush?.()
		}
	}

	if (!open) {
		return (
			<div className="commitbox is-collapsed">
				<button
					type="button"
					className="commitbox-header"
					aria-expanded={false}
					onClick={() => onToggleOpen(true)}
				>
					<CaretRight />
					<span className="commitbox-title">Commit</span>
					{trimmed !== "" && (
						<span className="commitbox-preview" title={message}>
							{firstLine(message)}
						</span>
					)}
				</button>
			</div>
		)
	}

	return (
		<div className={`commitbox ${recall !== null ? "has-recall" : ""}`}>
			<button
				type="button"
				className="commitbox-header"
				aria-expanded={true}
				onClick={() => onToggleOpen(false)}
			>
				<CaretDown />
				<span className="commitbox-title">Commit</span>
				<span className="commitbox-count">
					{stagedCount === 0
						? "nothing staged"
						: `${stagedCount} staged file${stagedCount === 1 ? "" : "s"}`}
				</span>
			</button>
			<textarea
				{...NO_AUTOCORRECT}
				ref={textareaRef}
				className="commitbox-message"
				aria-label="Commit message"
				placeholder="Commit message…"
				value={message}
				disabled={busy}
				onChange={(e) => setMessage(e.target.value)}
				onKeyDown={(e) => {
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
						e.preventDefault()
						void submit()
					}
				}}
			/>
			<div className="commitbox-actions">
				<label className="commitbox-amend">
					<input
						{...NO_AUTOCORRECT}
						type="checkbox"
						checked={amend}
						disabled={!canAmend || busy}
						onChange={(e) => void toggleAmend(e.target.checked)}
					/>
					Amend last commit
				</label>
				<button
					type="button"
					className={`commitbox-recall-btn ${recall !== null ? "is-on" : ""}`}
					aria-expanded={recall !== null}
					title="Reuse a recent commit message"
					onClick={() => void toggleRecall()}
				>
					<ClockCounterClockwise />
					Recent
				</button>
				{onCommitAndPush && (
					<button
						type="button"
						className="commitbox-commit is-secondary"
						disabled={!canCommit}
						title={`${amend ? "Amend" : "Commit"}, then push`}
						onClick={() => void submit(true)}
					>
						<ArrowUp />
						{amend ? "Amend & push" : "Commit & push"}
					</button>
				)}
				<button
					type="button"
					className="commitbox-commit"
					disabled={!canCommit}
					title={`${amend ? "Amend" : "Commit"} (${commitShortcutLabel(
						isMacPlatform(),
					)} from the message box)`}
					onClick={() => void submit()}
				>
					<Check />
					{busy ? "Committing…" : amend ? "Amend" : "Commit"}
				</button>
			</div>
			{recall !== null && (
				// An inline section, not an anchored dropdown — same pattern as
				// FileFilterPanel. It stretches (see `.has-recall`) so the list is
				// actually readable instead of a compressed strip.
				<div className="commitbox-recall" onKeyDown={onRecallKeyDown}>
					<div className="commitbox-recall-search">
						<MagnifyingGlass />
						<input
							{...NO_AUTOCORRECT}
							ref={recallSearchRef}
							type="text"
							aria-label="Search recent commit messages"
							placeholder={`Search ${recall.length} recent message${
								recall.length === 1 ? "" : "s"
							}…`}
							value={recallQuery}
							onChange={(e) => {
								setRecallQuery(e.target.value)
								setRecallIndex(0)
							}}
						/>
						<button
							type="button"
							className="commitbox-recall-close"
							aria-label="Close recent messages"
							onClick={() => {
								closeRecall()
								textareaRef.current?.focus()
							}}
						>
							<X />
						</button>
					</div>
					<div className="commitbox-recall-list" ref={recallListRef}>
						{matches.length === 0 ? (
							<div className="commitbox-recall-empty">
								{recall.length === 0
									? "No recent messages."
									: "No matching messages."}
							</div>
						) : (
							matches.map((m, i) => (
								<button
									// Messages repeat ("wip"), so the index is part of the identity.
									key={`${i}:${m}`}
									type="button"
									className={`commitbox-recall-item ${
										i === recallIndex ? "is-active" : ""
									}`}
									title={m}
									onMouseEnter={() => setRecallIndex(i)}
									onClick={() => pick(m)}
								>
									<span className="commitbox-recall-subject">
										{firstLine(m)}
									</span>
									{/* Flags a message with a body, so picking it isn't a
									    surprise — the whole thing goes into the box. */}
									{m.includes("\n") && (
										<span className="commitbox-recall-more">+body</span>
									)}
								</button>
							))
						)}
					</div>
				</div>
			)}
		</div>
	)
}

function firstLine(message: string): string {
	return message.split("\n")[0] ?? ""
}

// A guard against pasting something enormous into the box (e.g. a whole diff)
// and blocking on a git invocation with a megabyte-long argv.
const MAX_MESSAGE_LENGTH = 100_000

function isTooLong(message: string): boolean {
	return message.length > MAX_MESSAGE_LENGTH
}
