import { CaretDown, CaretRight } from "@phosphor-icons/react"
import { type ReactNode, useState } from "react"

export function SidebarSection({
	title,
	count,
	icon,
	children,
}: {
	title: string
	count: number
	icon?: ReactNode
	children: ReactNode
}) {
	const [open, setOpen] = useState(true)
	return (
		<div className="sidebar-section">
			<button
				type="button"
				className="sidebar-section-header"
				onClick={() => setOpen((o) => !o)}
			>
				<span className="sidebar-caret" aria-hidden="true">
					{open ? <CaretDown /> : <CaretRight />}
				</span>
				{icon && (
					<span className="sidebar-section-icon" aria-hidden="true">
						{icon}
					</span>
				)}
				<span className="sidebar-section-title">{title}</span>
				<span className="sidebar-section-count">{count}</span>
			</button>
			{open && <div className="sidebar-section-body">{children}</div>}
		</div>
	)
}
