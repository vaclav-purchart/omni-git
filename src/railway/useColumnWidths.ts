import { useCallback, useState } from "react"
import { getSetting, setSetting } from "../settings/settings"

export type ColKey = "author" | "commit" | "date"
export type ColWidths = Record<ColKey, number>

const KEY = "railway-cols"
const DEFAULTS: ColWidths = { author: 150, commit: 74, date: 88 }
const MIN: ColWidths = { author: 70, commit: 60, date: 64 }
const MAX = 400

function clampOne(key: ColKey, px: number): number {
	return Math.min(MAX, Math.max(MIN[key], Math.round(px)))
}

function loadOne(key: ColKey, value: unknown): number {
	return typeof value === "number" && Number.isFinite(value)
		? clampOne(key, value)
		: DEFAULTS[key]
}

function load(): ColWidths {
	try {
		const raw = getSetting(KEY)
		if (raw) {
			const p = JSON.parse(raw)
			return {
				author: loadOne("author", p.author),
				commit: loadOne("commit", p.commit),
				date: loadOne("date", p.date),
			}
		}
	} catch {}
	return DEFAULTS
}

export function useColumnWidths() {
	const [widths, setWidths] = useState<ColWidths>(load)
	const setWidth = useCallback((key: ColKey, px: number) => {
		setWidths((w) => ({ ...w, [key]: clampOne(key, px) }))
	}, [])
	const persist = useCallback(() => {
		setWidths((w) => {
			try {
				setSetting(KEY, JSON.stringify(w))
			} catch {}
			return w
		})
	}, [])
	return { widths, setWidth, persist }
}
