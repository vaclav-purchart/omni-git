import "./MiddlePath.css"

// Truncates a file path in the MIDDLE: the leading directories collapse with
// an ellipsis while the filename (last segment) stays fully visible, since
// both the path prefix and the filename carry meaning. Falls back to plain
// end-truncation when there is no separator. Full path is exposed as a tooltip.
export function MiddlePath({
	path,
	className,
}: {
	path: string
	className?: string
}) {
	const idx = path.lastIndexOf("/")
	const head = idx >= 0 ? path.slice(0, idx + 1) : ""
	const tail = idx >= 0 ? path.slice(idx + 1) : path
	return (
		<span className={`mid-path ${className ?? ""}`} title={path}>
			{head !== "" && <span className="mid-path-head">{head}</span>}
			<span className="mid-path-tail">{tail}</span>
		</span>
	)
}
