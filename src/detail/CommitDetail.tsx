import { useEffect, useRef, useState } from "react"
import { type CommitSummary, commands, type FileChange } from "../ipc/bindings"
import type { RefActions } from "../refs/refMenu"
import { ContextMenu, type MenuItem } from "../ui/ContextMenu"
import "./CommitDetail.css"
import { CommitMessage } from "./CommitMessage"
import { CommitRefs } from "./CommitRefs"
import { copyPathItem } from "./copyPathItem"
import { FileList } from "./FileList"
import { remoteFileItems } from "./remoteFileMenu"
import { useRemoteFile } from "./useRemoteFile"

// Committed files are read-only here: the only wired action is Copy Path.
// Everything else is scaffolded as disabled WIP so the menu shape matches the
// design spec ahead of the write-loop work that will implement it.
function buildFileMenu(path: string, remote: MenuItem[]): MenuItem[] {
	return [
		copyPathItem(path),
		// Grouped with Copy Path: both answer "give me a reference to this file",
		// one for here and one for someone else.
		...remote,
		{ type: "separator" },
		{ type: "item", label: "Log Selected…", wip: true },
		{ type: "item", label: "Annotate Selected…", wip: true },
		{ type: "item", label: "Reset to Commit…", wip: true },
		{ type: "separator" },
		{ type: "item", label: "Open Current Version", wip: true },
		{ type: "item", label: "Open Selected Version", wip: true },
		{ type: "item", label: "Show In Finder", wip: true },
		{ type: "item", label: "Quick Look", wip: true },
		{ type: "separator" },
		{ type: "item", label: "External Diff", wip: true },
	]
}

export function CommitDetail({
	repoPath,
	selectedCommit,
	selectedHashes,
	onFileDiff,
	ignoreWhitespace,
	forceText = false,
	refActions,
	filesRootRef,
	onAdvanceFiles,
	onRetreatFiles,
}: {
	repoPath: string
	selectedCommit: CommitSummary | null
	/**
	 * Every selected commit, newest-first, when more than one is picked. The panel
	 * then shows the combined changes rather than only the last row clicked —
	 * selecting three commits and being shown one is not a selection.
	 */
	selectedHashes?: string[]
	onFileDiff: (diff: string, path: string | null) => void
	ignoreWhitespace: boolean
	// Re-read this file with `--text` (git called it binary). Per-file, owned by
	// the workspace.
	forceText?: boolean
	// So a branch or tag on this commit offers the same actions here as it does in
	// the sidebar and on the railway row.
	refActions?: RefActions
	filesRootRef?: React.RefObject<HTMLDivElement | null>
	onAdvanceFiles?: () => void
	onRetreatFiles?: () => void
}) {
	const [files, setFiles] = useState<FileChange[]>([])
	const [activePath, setActivePath] = useState<string | null>(null)
	const [menu, setMenu] = useState<{
		pos: { x: number; y: number }
		items: MenuItem[]
	} | null>(null)
	// Bumped whenever the commit/repo changes, so in-flight commitFiles/fileDiff
	// requests from a previous commit can be detected and discarded.
	const genRef = useRef(0)
	// Bumped on every openFile call, so an earlier file click's slower fileDiff
	// response can't overwrite a later file click's result within the same commit.
	const reqRef = useRef(0)
	// Held in a ref so the load effect does NOT depend on the callback's identity.
	// A parent that passes an inline `onFileDiff` would otherwise re-run this
	// effect every render, causing an infinite commitFiles loop.
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

	// Depends on the HASH, not the CommitSummary object. A watcher-driven reload
	// replaces the commit list with fresh objects, so an object dependency
	// re-ran this for the same commit — clearing the file list and blanking the
	// diff, which showed up as the panel flashing after every mutation.
	const selectedHash = selectedCommit?.hash ?? null
	// One row selected is just the active commit by another name; the multi-commit
	// path only earns its extra git calls past that.
	const multi = (selectedHashes?.length ?? 0) > 1
	const hashes = multi ? (selectedHashes as string[]) : []
	// A stable primitive for the effects to key on: `selectedHashes` is a fresh
	// array on every render, and depending on it would re-fetch continuously.
	const selectionKey = multi ? hashes.join(",") : (selectedHash ?? "")
	// Linking a file to a forge only makes sense for ONE commit — with several
	// there is no single revision the line numbers belong to.
	const { urlFor, pushed } = useRemoteFile(
		repoPath,
		multi ? null : selectedHash,
	)
	useEffect(() => {
		genRef.current += 1
		const gen = genRef.current
		setActivePath(null)
		setFiles([])
		onFileDiffRef.current("", null)
		if (selectionKey === "") {
			return
		}
		const load = multi
			? commands.commitsFiles(repoPath, hashes)
			: commands.commitFiles(repoPath, selectedHash as string)
		load.then((r) => {
			if (genRef.current !== gen) {
				return
			}
			if (r.status === "ok") {
				setFiles(r.data)
			}
		})
		// `hashes`/`multi` are derived from selectionKey, so keying on it alone is
		// both sufficient and stable.
	}, [repoPath, selectionKey])

	async function openFile(path: string) {
		if (selectedCommit === null) {
			return
		}
		const gen = genRef.current
		reqRef.current += 1
		const req = reqRef.current
		setActivePath(path)
		const r = multi
			? await commands.commitsFileDiff(
					repoPath,
					hashes,
					path,
					ignoreWhitespace,
					forceText,
				)
			: await commands.fileDiff(
					repoPath,
					selectedCommit.hash,
					path,
					ignoreWhitespace,
					forceText,
				)
		if (genRef.current !== gen || reqRef.current !== req) {
			return
		}
		if (!aliveRef.current) {
			return
		}
		onFileDiffRef.current(r.status === "ok" ? r.data : "", path)
	}

	// Re-fetch the open file's diff when the whitespace mode flips.
	useEffect(() => {
		if (activePath !== null) {
			void openFile(activePath)
		}
	}, [ignoreWhitespace, forceText])

	if (selectedCommit === null) {
		return (
			<div className="detail-empty">Select a commit to see its changes.</div>
		)
	}
	return (
		<div className="detail-root">
			{!multi && (
				<CommitRefs
					refs={selectedCommit.refs}
					hash={selectedCommit.hash}
					actions={refActions}
					onOpenMenu={(items, e) =>
						setMenu({ pos: { x: e.clientX, y: e.clientY }, items })
					}
				/>
			)}
			<FileList
				ariaLabel="Changed files"
				subject={
					multi
						? `${hashes.length} commits selected — combined changes`
						: selectedCommit.subject
				}
				sections={[{ key: "changed", files }]}
				activeKey={
					activePath === null ? null : { section: "changed", path: activePath }
				}
				onOpen={(_, path) => openFile(path)}
				onRowContextMenu={(f, _section, e) => {
					e.preventDefault()
					setMenu({
						pos: { x: e.clientX, y: e.clientY },
						items: buildFileMenu(
							f.path,
							remoteFileItems({ url: urlFor(f.path), pushed }),
						),
					})
				}}
				rootRef={filesRootRef}
				onAdvance={onAdvanceFiles}
				onRetreat={onRetreatFiles}
			/>
			{!multi && (
				// One message per commit; with several selected there is no single
				// message to show, and picking one of them would misattribute it.
				<CommitMessage
					repoPath={repoPath}
					hash={selectedCommit.hash}
					subject={selectedCommit.subject}
				/>
			)}
			{menu && (
				<ContextMenu
					items={menu.items}
					position={menu.pos}
					onClose={() => setMenu(null)}
				/>
			)}
		</div>
	)
}
