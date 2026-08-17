import { useRef } from "react"
import type { ColKey, ColWidths } from "./useColumnWidths"

function Handle({
	col,
	width,
	setWidth,
	persist,
}: {
	col: ColKey
	width: number
	setWidth: (k: ColKey, px: number) => void
	persist: () => void
}) {
	const start = useRef<{ x: number; w: number } | null>(null)
	return (
		<span
			className="railway-col-handle"
			onPointerDown={(e) => {
				e.preventDefault()
				start.current = { x: e.clientX, w: width }
				e.currentTarget.setPointerCapture(e.pointerId)
			}}
			onPointerMove={(e) => {
				if (start.current) {
					setWidth(col, start.current.w + (start.current.x - e.clientX))
				}
			}}
			onPointerUp={(e) => {
				start.current = null
				e.currentTarget.releasePointerCapture(e.pointerId)
				persist()
			}}
		/>
	)
}

export function RailwayHeader({
	widths,
	setWidth,
	persist,
}: {
	widths: ColWidths
	setWidth: (k: ColKey, px: number) => void
	persist: () => void
}) {
	return (
		<div className="railway-header">
			<div className="railway-col railway-col-graph" />
			<div className="railway-col railway-col-desc">Description</div>
			<div className="railway-col railway-col-author">
				<Handle
					col="author"
					width={widths.author}
					setWidth={setWidth}
					persist={persist}
				/>
				Author
			</div>
			<div className="railway-col railway-col-commit">
				<Handle
					col="commit"
					width={widths.commit}
					setWidth={setWidth}
					persist={persist}
				/>
				Commit
			</div>
			<div className="railway-col railway-col-date">
				<Handle
					col="date"
					width={widths.date}
					setWidth={setWidth}
					persist={persist}
				/>
				Date
			</div>
		</div>
	)
}
