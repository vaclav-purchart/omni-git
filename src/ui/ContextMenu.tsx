import { Wrench } from "@phosphor-icons/react"
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react"
import { createPortal } from "react-dom"
import "./ContextMenu.css"

export type MenuItem =
	| { type: "separator" }
	| {
			type: "item"
			label: string
			icon?: ReactNode
			onClick?: () => void
			disabled?: boolean
			wip?: boolean
			danger?: boolean
			/**
			 * Keyboard equivalent, already in the platform's notation (the caller knows
			 * the platform; this component doesn't need to). Shown right-aligned.
			 */
			shortcut?: string
	  }

/**
 * Keys an open menu takes for itself.
 *
 * These are exactly the ones the panels behind it bind for navigation: the
 * railway walks commits with the arrows, Home and End; the file list walks files
 * and uses Enter/Backspace to move between panels. A menu on top of them has to
 * be the only thing responding.
 */
const CLAIMED_KEYS = new Set([
	"ArrowDown",
	"ArrowUp",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"Enter",
	"Backspace",
])

export type ContextMenuProps = {
	items: MenuItem[]
	position: { x: number; y: number }
	onClose: () => void
}

// A reusable popup menu rendered via a portal to document.body, positioned at
// a fixed viewport coordinate and clamped so it never overflows the window.
// It closes itself on Escape, an outside click, or the window losing focus
// or being scrolled/resized — callers just supply items + position + onClose.
export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null)
	const [pos, setPos] = useState(position)

	// Clamp into the viewport once we can measure the rendered menu's size.
	// This runs before paint, so an out-of-bounds seed position is never
	// actually visible to the user. Re-runs if the caller repositions the
	// menu (e.g. a fresh right-click while it's already open).
	useLayoutEffect(() => {
		const el = menuRef.current
		if (!el) {
			setPos(position)
			return
		}
		const rect = el.getBoundingClientRect()
		let x = position.x
		let y = position.y
		if (x + rect.width > window.innerWidth) {
			x = Math.max(0, window.innerWidth - rect.width)
		}
		if (y + rect.height > window.innerHeight) {
			y = Math.max(0, window.innerHeight - rect.height)
		}
		setPos({ x, y })
	}, [position.x, position.y])

	// Move focus onto the menu as soon as it opens, so arrow keys work right
	// away without requiring a prior Tab/click into the menu.
	useEffect(() => {
		menuRef.current
			?.querySelector<HTMLButtonElement>("button:not([disabled])")
			?.focus()
	}, [])

	function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
		// While the menu is open it OWNS these keys. A portal's events still
		// propagate through the React tree, not the DOM one, so without this the
		// panel that opened the menu also sees them — arrowing through the menu
		// moved the commit selection underneath it, and Enter both ran the item and
		// jumped focus to the next panel.
		//
		// Escape is deliberately not in the set: it is handled by a document-level
		// listener below, which sits ABOVE this portal, so stopping it here would
		// leave the menu unclosable by keyboard.
		if (CLAIMED_KEYS.has(e.key)) {
			e.stopPropagation()
		}
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
			return
		}
		e.preventDefault()
		const menu = menuRef.current
		if (!menu) {
			return
		}
		const buttons = Array.from(
			menu.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
		)
		if (buttons.length === 0) {
			return
		}
		const currentIndex = buttons.indexOf(
			document.activeElement as HTMLButtonElement,
		)
		const nextIndex =
			e.key === "ArrowDown"
				? currentIndex === -1
					? 0
					: (currentIndex + 1) % buttons.length
				: currentIndex === -1
					? buttons.length - 1
					: (currentIndex - 1 + buttons.length) % buttons.length
		buttons[nextIndex]?.focus()
	}

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				// Claim the key so outer Escape handlers (e.g. the command-output
				// panel) stand down — Escape should close the innermost thing only.
				e.preventDefault()
				onClose()
			}
		}
		function onMouseDown(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose()
			}
		}
		function onDismiss() {
			onClose()
		}
		document.addEventListener("keydown", onKeyDown)
		document.addEventListener("mousedown", onMouseDown)
		window.addEventListener("blur", onDismiss)
		window.addEventListener("scroll", onDismiss, true)
		window.addEventListener("resize", onDismiss)
		return () => {
			document.removeEventListener("keydown", onKeyDown)
			document.removeEventListener("mousedown", onMouseDown)
			window.removeEventListener("blur", onDismiss)
			window.removeEventListener("scroll", onDismiss, true)
			window.removeEventListener("resize", onDismiss)
		}
	}, [onClose])

	return createPortal(
		<div
			ref={menuRef}
			className="context-menu"
			role="menu"
			style={{ left: pos.x, top: pos.y }}
			onKeyDown={onMenuKeyDown}
		>
			{items.map((item, i) =>
				item.type === "separator" ? (
					<div key={i} role="separator" className="context-menu-sep" />
				) : (
					<button
						key={i}
						type="button"
						role="menuitem"
						className={`context-menu-item${item.danger ? " is-danger" : ""}`}
						disabled={item.disabled || item.wip}
						title={item.wip ? "Not yet implemented" : undefined}
						// Hovering MOVES focus, rather than only painting a hover colour.
						// Menus have one active item, and with focus and hover tracked
						// separately the pointer could highlight one row while Enter fired
						// another. This keeps them the same thing.
						onMouseEnter={(e) => e.currentTarget.focus()}
						onClick={() => {
							item.onClick?.()
							onClose()
						}}
					>
						{item.icon}
						{item.label}
						{item.shortcut !== undefined && (
							// Hidden from assistive tech: it would otherwise become part of
							// the item's accessible name ("Copy Path To Clipboard ⌘⇧C"), and
							// the symbols read badly. `aria-keyshortcuts` is the right home
							// for this, but it wants "Meta+Shift+C" rather than the symbols
							// shown here — so the keys stay discoverable through the help
							// overlay instead of being announced non-conformingly.
							<span className="context-menu-shortcut" aria-hidden="true">
								{item.shortcut}
							</span>
						)}
						{item.wip && (
							<span className="context-menu-wip">
								<Wrench />
							</span>
						)}
					</button>
				),
			)}
		</div>,
		document.body,
	)
}
