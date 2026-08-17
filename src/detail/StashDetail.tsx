import { ArrowFatLineDown, Copy } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"
import { commands, type FileChange, type Stash } from "../ipc/bindings"
import { ContextMenu, type MenuItem } from "../ui/ContextMenu"
import "./CommitDetail.css"
import "./StashDetail.css"
import { copyPathItem } from "./copyPathItem"
import { FileList } from "./FileList"

/**
 * A stash's contents: its files, and its patches.
 *
 * Read-only, like a commit's — a stash is a snapshot, and the only things you do
 * TO one are apply it, pop it, or drop it. The first two live in the toolbar
 * here; dropping is not offered yet.
 */
export function StashDetail({
	repoPath,
	stash,
	onFileDiff,
	ignoreWhitespace,
	forceText = false,
	onApply,
	onPop,
	filesRootRef,
	onAdvanceFiles,
	onRetreatFiles,
}: {
	repoPath: string
	stash: Stash | null
	onFileDiff: (diff: string, path: string | null) => void
	ignoreWhitespace: boolean
	forceText?: boolean
	// Both run in the workspace, which owns the output panel and the reload.
	onApply?: (stash: Stash) => void
	onPop?: (stash: Stash) => void
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
	// Bumped whenever the stash/repo changes, so in-flight requests from a
	// previous one can be detected and discarded.
	const genRef = useRef(0)
	// Bumped per openFile, so a slower earlier request can't overwrite a later
	// file's result.
	const reqRef = useRef(0)
	// Held in a ref so the load effect does not depend on the callback's identity;
	// an inline `onFileDiff` from the parent would otherwise re-run it every
	// render.
	const onFileDiffRef = useRef(onFileDiff)
	useEffect(() => {
		onFileDiffRef.current = onFileDiff
	}, [onFileDiff])
	const aliveRef = useRef(true)
	useEffect(() => {
		return () => {
			aliveRef.current = false
		}
	}, [])

	// Keyed on the SELECTOR rather than the object: a reload replaces the stash
	// list with fresh objects, and an object dependency would re-run this for the
	// same stash, blanking the panel after every mutation.
	const selector = stash?.selector ?? null
	useEffect(() => {
		genRef.current += 1
		const gen = genRef.current
		setActivePath(null)
		setFiles([])
		onFileDiffRef.current("", null)
		if (selector === null) {
			return
		}
		commands.stashFiles(repoPath, selector).then((r) => {
			if (genRef.current !== gen) {
				return
			}
			if (r.status === "ok") {
				setFiles(r.data)
			}
		})
	}, [repoPath, selector])

	async function openFile(path: string) {
		if (selector === null) {
			return
		}
		const gen = genRef.current
		reqRef.current += 1
		const req = reqRef.current
		setActivePath(path)
		const r = await commands.stashFileDiff(
			repoPath,
			selector,
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

	if (stash === null) {
		return (
			<div className="detail-empty">Select a stash to see its changes.</div>
		)
	}

	return (
		<div className="detail-root">
			<FileList
				ariaLabel="Stashed files"
				subject={stash.message}
				toolbar={
					<>
						{/* Apply first: it is the reversible one. Pop drops the stash once
						    it lands, so it reads second and says what it does. */}
						<button
							type="button"
							className="wc-toolbar-btn"
							title={`Apply ${stash.selector}, keeping the stash`}
							onClick={() => onApply?.(stash)}
						>
							<Copy />
							Apply
						</button>
						<button
							type="button"
							className="wc-toolbar-btn"
							title={`Apply ${stash.selector} and drop it`}
							onClick={() => onPop?.(stash)}
						>
							<ArrowFatLineDown />
							Pop
						</button>
						<span className="stash-selector">{stash.selector}</span>
					</>
				}
				sections={[{ key: "stashed", files }]}
				activeKey={
					activePath === null ? null : { section: "stashed", path: activePath }
				}
				onOpen={(_, path) => openFile(path)}
				onRowContextMenu={(f, _section, e) => {
					e.preventDefault()
					setMenu({
						pos: { x: e.clientX, y: e.clientY },
						items: [copyPathItem(f.path)],
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
		</div>
	)
}
