import { useEffect, useRef, useState } from "react"
import { commands, type FileChange } from "../ipc/bindings"
import { ContextMenu, type MenuItem } from "../ui/ContextMenu"
import "./CommitDetail.css"
import { copyPathItem } from "./copyPathItem"
import { FileList } from "./FileList"

// Compare/PR files are read-only here too: only Copy Path is wired, the rest
// is scaffolded WIP (see CommitDetail's buildFileMenu for the same pattern).
function buildFileMenu(path: string): MenuItem[] {
	return [
		copyPathItem(path),
		{ type: "separator" },
		{ type: "item", label: "Open at head", wip: true },
		{ type: "item", label: "Open at base", wip: true },
		{ type: "item", label: "Show In Finder", wip: true },
		{ type: "separator" },
		{ type: "item", label: "External Diff", wip: true },
	]
}

export function CompareDetail({
	repoPath,
	base,
	head,
	includeWorktree = false,
	onFileDiff,
	ignoreWhitespace,
	forceText = false,
	filesRootRef,
	onAdvanceFiles,
	onRetreatFiles,
}: {
	repoPath: string
	base: string
	head: string
	/**
	 * Fold the working tree into the comparison — only ever true when `head` is
	 * the branch that is checked out, since the working tree belongs to HEAD and
	 * attributing it to another branch would be a lie.
	 */
	includeWorktree?: boolean
	onFileDiff: (diff: string, path: string | null) => void
	ignoreWhitespace: boolean
	// Re-read this file with `--text` (git called it binary). Per-file, owned by
	// the workspace.
	forceText?: boolean
	filesRootRef?: React.RefObject<HTMLDivElement | null>
	onAdvanceFiles?: () => void
	onRetreatFiles?: () => void
}) {
	const [files, setFiles] = useState<FileChange[]>([])
	const [activePath, setActivePath] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [menu, setMenu] = useState<{
		pos: { x: number; y: number }
		items: MenuItem[]
	} | null>(null)
	const genRef = useRef(0)
	const reqRef = useRef(0)
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

	useEffect(() => {
		genRef.current += 1
		const gen = genRef.current
		setActivePath(null)
		setFiles([])
		setError(null)
		onFileDiffRef.current("", null)
		commands.branchDiff(repoPath, base, head, includeWorktree).then((r) => {
			if (genRef.current !== gen) {
				return
			}
			if (r.status === "ok") {
				setFiles(r.data)
			} else {
				setError(
					"NonZero" in r.error
						? r.error.NonZero.stderr
						: "Failed to diff branch",
				)
			}
		})
	}, [repoPath, base, head, includeWorktree])

	async function openFile(path: string) {
		const gen = genRef.current
		reqRef.current += 1
		const req = reqRef.current
		setActivePath(path)
		const r = await commands.branchFileDiff(
			repoPath,
			base,
			head,
			path,
			ignoreWhitespace,
			forceText,
			includeWorktree,
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

	if (error !== null) {
		return <div className="detail-empty">{error}</div>
	}
	if (files.length === 0) {
		return (
			<div className="detail-empty">
				No changes between {head} and {base}.
			</div>
		)
	}
	return (
		<>
			<FileList
				ariaLabel="Changed files"
				subject={`${head} ← ${base}`}
				sections={[{ key: "changed", files }]}
				activeKey={
					activePath === null ? null : { section: "changed", path: activePath }
				}
				onOpen={(_, path) => openFile(path)}
				onRowContextMenu={(f, _section, e) => {
					e.preventDefault()
					setMenu({
						pos: { x: e.clientX, y: e.clientY },
						items: buildFileMenu(f.path),
					})
				}}
				rootRef={filesRootRef}
				onAdvance={onAdvanceFiles}
				onRetreat={onRetreatFiles}
			/>
			{menu && (
				<ContextMenu
					items={menu.items}
					position={menu.pos}
					onClose={() => setMenu(null)}
				/>
			)}
		</>
	)
}
