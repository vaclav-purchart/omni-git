import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import type { FileChange } from "../ipc/bindings"
import { MiddlePath } from "../ui/MiddlePath"
import { usePersistentState } from "../ui/usePersistentState"
import "./CommitDetail.css"
import "./FileList.css"
import { FileFilterBar } from "./FileFilterBar"
import { FileFilterPanel } from "./FileFilterPanel"
import { isTestFile } from "./fileClass"
import { applyFileFilters } from "./fileFilter"
import { useFileFilters } from "./useFileFilters"

export type FileSection = {
	key: string
	label?: string
	files: FileChange[]
	/**
	 * The top-level division this section belongs to. Consecutive sections sharing
	 * one are rendered under a single heading.
	 *
	 * Preparing a commit is really a question of what IS in it and what isn't;
	 * staged/unstaged/untracked are subtypes of that answer, not three peers. Left
	 * undefined by the read-only lists (a commit, a comparison), which have nothing
	 * to divide.
	 */
	group?: string
}

export type FileRow = { section: string; path: string }

/** The key a row is tracked by in a multi-selection. */
export function rowKey(section: string, path: string): string {
	return `${section}:${path}`
}

export type FileListProps = {
	ariaLabel: string
	sections: FileSection[]
	activeKey: { section: string; path: string } | null
	onOpen: (section: string, path: string) => void
	/**
	 * Rows in the multi-selection, as `rowKey` values. The active row is not
	 * implicitly a member: a selection of one is just the active row, and the
	 * parent decides whether that counts.
	 */
	selectedKeys?: ReadonlySet<string>
	/** Cmd/Ctrl+click: add or remove a single row. */
	onToggleSelect?: (section: string, path: string) => void
	/**
	 * Shift+click, and Shift+Arrow: every row between the anchor and this one, in
	 * the order they are currently displayed. Computed here rather than by the
	 * parent because only this component knows what the filters left visible.
	 */
	onSelectRange?: (rows: FileRow[]) => void
	subject?: ReactNode
	toolbar?: ReactNode
	renderRowActions?: (file: FileChange, section: string) => ReactNode
	/** Section-level actions, revealed when the section's header is hovered. */
	renderSectionActions?: (section: string, files: FileChange[]) => ReactNode
	/**
	 * Actions for a whole top-level group, revealed on hover like the section ones.
	 * Not called for a group holding a single section — that section's own actions
	 * move up to the group heading instead, since there is nothing to distinguish
	 * them from.
	 */
	renderGroupActions?: (group: string, files: FileChange[]) => ReactNode
	onRowContextMenu?: (
		file: FileChange,
		section: string,
		e: React.MouseEvent,
	) => void
	rootRef?: React.RefObject<HTMLDivElement | null>
	onAdvance?: () => void
	onRetreat?: () => void
}

// The unified changed-files list: renders one or more sections of files,
// applies the global file filters (hide/highlight, see fileFilter.ts) plus a
// local "Hide tests" toggle, and owns keyboard nav + active-row scrolling
// across the flattened, currently-visible rows. Selection is controlled by
// the parent via `activeKey`/`onOpen`, since the parent owns diff-loading.
export function FileList({
	ariaLabel,
	sections,
	activeKey,
	onOpen,
	selectedKeys,
	onToggleSelect,
	onSelectRange,
	subject,
	toolbar,
	renderRowActions,
	renderSectionActions,
	renderGroupActions,
	onRowContextMenu,
	rootRef,
	onAdvance,
	onRetreat,
}: FileListProps) {
	const { filters, addFilter, updateFilter, removeFilter, setEnabled } =
		useFileFilters()
	const [hideTests, setHideTests] = usePersistentState("hide-tests", false)
	const [filtersOpen, setFiltersOpen] = usePersistentState(
		"filters-open",
		false,
	)
	const activeRef = useRef<HTMLButtonElement>(null)
	const headerRef = useRef<HTMLDivElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (!filtersOpen) {
			return
		}
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				setFiltersOpen(false)
			}
		}
		function onMouseDown(e: MouseEvent) {
			const target = e.target as Node
			if (
				headerRef.current?.contains(target) ||
				panelRef.current?.contains(target)
			) {
				return
			}
			setFiltersOpen(false)
		}
		document.addEventListener("keydown", onKeyDown)
		document.addEventListener("mousedown", onMouseDown)
		return () => {
			document.removeEventListener("keydown", onKeyDown)
			document.removeEventListener("mousedown", onMouseDown)
		}
	}, [filtersOpen])

	const viewSections = sections.map((s) => {
		const { visible, highlighted, testCount } = applyFileFilters(
			s.files,
			filters,
			hideTests,
		)
		return { ...s, visible, highlighted, testCount }
	})
	const testCount = viewSections.reduce((sum, s) => sum + s.testCount, 0)
	const rawTotal = sections.reduce((sum, s) => sum + s.files.length, 0)

	// Which row the pointer is over. Cleared whenever the rows themselves change,
	// because the browser won't correct a stale :hover — or fire mouseenter — until
	// the mouse actually moves, and by then the buttons have been sitting on the
	// wrong file. The active row shows its actions regardless (see the CSS), so
	// there is always somewhere sensible for them to be.
	const [hoveredKey, setHoveredKey] = useState<string | null>(null)
	const [hoveredSection, setHoveredSection] = useState<string | null>(null)
	const rowSignature = useMemo(
		() =>
			sections
				.map((s) => `${s.key}:${s.files.map((f) => f.path).join(",")}`)
				.join("|"),
		[sections],
	)
	useEffect(() => {
		setHoveredKey(null)
		setHoveredSection(null)
	}, [rowSignature])
	const visibleTotal = viewSections.reduce(
		(sum, s) => sum + s.visible.length,
		0,
	)

	const flattened: { section: string; path: string }[] = viewSections.flatMap(
		(s) => s.visible.map((f) => ({ section: s.key, path: f.path })),
	)

	// Consecutive sections sharing a group, with the empty ones dropped: a heading
	// for a division that has nothing under it is a heading for nothing. A section
	// with no group is its own run and gets no heading, which is how the read-only
	// lists (a commit, a comparison) keep behaving exactly as before.
	type Run = { group: string | undefined; sections: typeof viewSections }
	const runs: Run[] = []
	for (const section of viewSections) {
		if (section.visible.length === 0) {
			continue
		}
		const last = runs[runs.length - 1]
		if (
			last !== undefined &&
			section.group !== undefined &&
			last.group === section.group
		) {
			last.sections.push(section)
		} else {
			runs.push({ group: section.group, sections: [section] })
		}
	}

	// Depend on the primitive section/path rather than the `activeKey` object,
	// so a parent that rebuilds the object literal each render (e.g. CommitDetail)
	// doesn't re-fire scrollIntoView on unrelated re-renders — only on a real
	// selection change.
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" })
	}, [activeKey?.section, activeKey?.path])

	// How far Shift+Arrow has reached. Null until one is pressed, and reset
	// whenever the anchor moves, so a plain click always starts a fresh range.
	const [leadIndex, setLeadIndex] = useState<number | null>(null)
	useEffect(() => {
		setLeadIndex(null)
	}, [activeKey?.section, activeKey?.path])

	function indexOfActive(): number {
		return flattened.findIndex(
			(f) =>
				activeKey !== null &&
				f.section === activeKey.section &&
				f.path === activeKey.path,
		)
	}

	/**
	 * The visible rows between the anchor and `to`, inclusive.
	 *
	 * Order is display order, not click order, so a range dragged upwards reads the
	 * same as one dragged down — and the parent can act on it without re-sorting.
	 */
	function rangeTo(to: number): FileRow[] {
		const from = indexOfActive()
		if (from === -1) {
			return [flattened[to]]
		}
		const [lo, hi] = from <= to ? [from, to] : [to, from]
		return flattened.slice(lo, hi + 1)
	}

	function move(delta: number, extend: boolean) {
		if (flattened.length === 0) {
			return
		}
		const cur = indexOfActive()
		if (extend && onSelectRange) {
			// The range grows from the ANCHOR (the active row) while a separate LEAD
			// moves. Without the lead, every press would measure active→active+1 and
			// the selection could never be more than two rows.
			const from = leadIndex ?? cur
			const next = Math.min(
				flattened.length - 1,
				Math.max(0, (from === -1 ? 0 : from) + delta),
			)
			setLeadIndex(next)
			onSelectRange(rangeTo(next))
			return
		}
		const next =
			cur === -1
				? delta > 0
					? 0
					: flattened.length - 1
				: Math.min(flattened.length - 1, Math.max(0, cur + delta))
		onOpen(flattened[next].section, flattened[next].path)
	}

	/** Jumps to an absolute row, for Home/End and Cmd/Ctrl+Arrow. */
	function moveToEnd(last: boolean) {
		if (flattened.length === 0) {
			return
		}
		const row = flattened[last ? flattened.length - 1 : 0]
		onOpen(row.section, row.path)
	}

	function onKeyDown(e: React.KeyboardEvent) {
		// Cmd/Ctrl+A selects every row the filters have left visible — "all" means
		// all of what you can see, not rows that are hidden from you.
		//
		// Matched on `code`: with a modifier held, `key` varies by keyboard layout.
		// preventDefault stops the browser selecting the panel's text instead.
		if (
			(e.metaKey || e.ctrlKey) &&
			!e.altKey &&
			e.code === "KeyA" &&
			onSelectRange
		) {
			e.preventDefault()
			onSelectRange(flattened)
			return
		}
		// Cmd/Ctrl+Arrow jumps to the end of the list, the way it does in a text
		// field — checked before the plain arrows, which move by one.
		if (
			(e.metaKey || e.ctrlKey) &&
			(e.key === "ArrowUp" || e.key === "ArrowDown")
		) {
			e.preventDefault()
			moveToEnd(e.key === "ArrowDown")
			return
		}
		if (e.key === "Home" || e.key === "End") {
			e.preventDefault()
			moveToEnd(e.key === "End")
			return
		}
		if (e.key === "ArrowDown") {
			e.preventDefault()
			move(1, e.shiftKey)
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			move(-1, e.shiftKey)
		} else if (e.key === "Enter") {
			e.preventDefault()
			onAdvance?.()
		} else if (e.key === "Backspace") {
			e.preventDefault()
			onRetreat?.()
		}
	}

	return (
		<div className="filelist">
			<div className="detail-subject-row" ref={headerRef}>
				{subject !== undefined && (
					<div
						className="detail-subject"
						title={typeof subject === "string" ? subject : undefined}
					>
						{subject}
					</div>
				)}
				{toolbar}
				<FileFilterBar
					testCount={testCount}
					hideTests={hideTests}
					onToggleHideTests={() => setHideTests((h) => !h)}
					filters={filters}
					open={filtersOpen}
					onToggleOpen={() => setFiltersOpen((o) => !o)}
				/>
			</div>
			{filtersOpen && (
				<FileFilterPanel
					ref={panelRef}
					filters={filters}
					onAddFilter={addFilter}
					onUpdateFilter={updateFilter}
					onRemoveFilter={removeFilter}
					onSetEnabled={setEnabled}
				/>
			)}
			{rawTotal > 0 && visibleTotal === 0 && (
				<div className="file-list-hint">All files filtered out.</div>
			)}
			<div
				className="detail"
				ref={rootRef}
				tabIndex={0}
				role="listbox"
				aria-label={ariaLabel}
				onKeyDown={onKeyDown}
			>
				{runs.map((run) => (
					<div key={run.group ?? run.sections[0].key}>
						{run.group !== undefined && (
							// The division that matters when preparing a commit. Rendered
							// louder than the section headings under it: those name a
							// subtype, this names whether the files are in the commit at all.
							<div
								className={`wc-group-header g-${run.sections[0].key} ${
									hoveredSection === run.group ? "is-hovered" : ""
								}`}
								onMouseEnter={() => setHoveredSection(run.group ?? null)}
								onMouseLeave={() => setHoveredSection(null)}
							>
								<span className="wc-group-label">{run.group}</span>
								<span className="wc-group-count">
									{run.sections.reduce((n, x) => n + x.visible.length, 0)}
								</span>
								<span className="wc-section-actions">
									{run.sections.length === 1
										? renderSectionActions?.(
												run.sections[0].key,
												run.sections[0].visible,
											)
										: renderGroupActions?.(
												run.group,
												run.sections.flatMap((x) => x.visible),
											)}
								</span>
							</div>
						)}
						{run.sections.map((s) => (
							<div key={s.key}>
								{/* Suppressed when the group holds only this one section:
								    "Staged in this commit / Staged" is the same statement twice,
								    the section's actions have moved up to the group heading. */}
								{s.label !== undefined &&
									!(run.group !== undefined && run.sections.length === 1) && (
										// `s-<key>` carries the per-group colour; hover is
										// state-driven for the same reason as the rows (see below).
										<div
											className={`wc-section-header s-${s.key} ${
												hoveredSection === s.key ? "is-hovered" : ""
											}`}
											onMouseEnter={() => setHoveredSection(s.key)}
											onMouseLeave={() => setHoveredSection(null)}
										>
											<span className="wc-section-label">{s.label}</span>
											<span className="wc-section-count">
												{s.visible.length}
											</span>
											{renderSectionActions !== undefined && (
												<span className="wc-section-actions">
													{renderSectionActions(s.key, s.visible)}
												</span>
											)}
										</div>
									)}
								<ul className="detail-files">
									{s.visible.map((f) => {
										const isActive =
											activeKey !== null &&
											activeKey.section === s.key &&
											activeKey.path === f.path
										const key = rowKey(s.key, f.path)
										const isSelected = selectedKeys?.has(key) === true
										return (
											<li
												key={key}
												// Hover is tracked in STATE, not with CSS :hover.
												// Browsers don't re-evaluate :hover when the DOM shifts
												// under a stationary cursor, so after staging a file the
												// row that moved up kept the previous row's hover and the
												// buttons appeared on the wrong file.
												className={key === hoveredKey ? "is-hovered" : ""}
												onMouseEnter={() => setHoveredKey(key)}
												onMouseLeave={() => setHoveredKey(null)}
											>
												<button
													type="button"
													ref={isActive ? activeRef : undefined}
													aria-selected={isSelected || isActive}
													className={`detail-file ${isActive ? "is-active" : ""} ${isSelected ? "is-selected" : ""} ${isTestFile(f.path) ? "is-test" : ""} ${s.highlighted.has(f.path) ? "is-highlight" : ""}`}
													onClick={(e) => {
														// WebKit doesn't focus a <button> on click; focus
														// the list container so Enter/Backspace nav works.
														rootRef?.current?.focus()
														// metaKey for macOS, ctrlKey elsewhere. Both are
														// accepted on both platforms rather than branching on
														// the OS: neither means anything else on a row.
														if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
															onToggleSelect(s.key, f.path)
															return
														}
														if (e.shiftKey && onSelectRange) {
															// A range is measured in flattened visible rows, so
															// the index has to account for the sections above
															// this one, not just the position within it.
															const to = flattened.findIndex(
																(r) => r.section === s.key && r.path === f.path,
															)
															// Shift+Arrow continues from where a Shift+click
															// left off, so the click has to move the lead too.
															setLeadIndex(to)
															onSelectRange(rangeTo(to))
															return
														}
														onOpen(s.key, f.path)
													}}
													onContextMenu={(e) => onRowContextMenu?.(f, s.key, e)}
												>
													<span
														className={`detail-status s-${f.status[0]}`}
														title={f.status}
													>
														{f.status}
													</span>
													<MiddlePath path={f.path} className="detail-path" />
												</button>
												{renderRowActions?.(f, s.key)}
											</li>
										)
									})}
								</ul>
							</div>
						))}
					</div>
				))}
			</div>
		</div>
	)
}
