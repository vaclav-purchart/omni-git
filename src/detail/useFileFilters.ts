import { useCallback, useState } from "react"
import { getSetting, setSetting } from "../settings/settings"
import type { FileFilter } from "./fileFilter"

const KEY = "file-filters"

function load(): FileFilter[] {
	try {
		const raw = getSetting(KEY)
		if (!raw) return []
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter(
			(f): f is FileFilter =>
				f &&
				typeof f.id === "string" &&
				typeof f.pattern === "string" &&
				(f.mode === "hide" || f.mode === "highlight") &&
				typeof f.enabled === "boolean",
		)
	} catch {
		return []
	}
}

function save(next: FileFilter[]) {
	try {
		setSetting(KEY, JSON.stringify(next))
	} catch {}
}

function newFilterId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID()
	}
	return `f-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

export function useFileFilters() {
	const [filters, setFilters] = useState<FileFilter[]>(load)

	const addFilter = useCallback((pattern: string, mode: FileFilter["mode"]) => {
		const p = pattern.trim()
		if (p === "") return
		setFilters((prev) => {
			const next = [
				...prev,
				{ id: newFilterId(), pattern: p, mode, enabled: true },
			]
			save(next)
			return next
		})
	}, [])

	const updateFilter = useCallback(
		(id: string, patch: Partial<Omit<FileFilter, "id">>) => {
			setFilters((prev) => {
				const next = prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
				save(next)
				return next
			})
		},
		[],
	)

	const removeFilter = useCallback((id: string) => {
		setFilters((prev) => {
			const next = prev.filter((f) => f.id !== id)
			save(next)
			return next
		})
	}, [])

	const setEnabled = useCallback(
		(id: string, enabled: boolean) => updateFilter(id, { enabled }),
		[updateFilter],
	)

	return { filters, addFilter, updateFilter, removeFilter, setEnabled }
}
