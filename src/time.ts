export function formatRelative(timestampMs: number, nowMs: number): string {
	const diff = nowMs - timestampMs
	const sec = Math.floor(diff / 1000)
	if (sec < 60) {
		return "just now"
	}
	const min = Math.floor(sec / 60)
	if (min < 60) {
		return `${min}m ago`
	}
	const hr = Math.floor(min / 60)
	if (hr < 24) {
		return `${hr}h ago`
	}
	const day = Math.floor(hr / 24)
	if (day < 7) {
		return `${day}d ago`
	}
	const d = new Date(timestampMs)
	const y = d.getUTCFullYear()
	const m = String(d.getUTCMonth() + 1).padStart(2, "0")
	const dd = String(d.getUTCDate()).padStart(2, "0")
	return `${y}-${m}-${dd}`
}
