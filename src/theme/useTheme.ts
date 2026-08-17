import { useCallback, useEffect, useState } from "react"
import { getSetting, setSetting } from "../settings/settings"

export type ThemePref = "system" | "light" | "dark"
const STORAGE_KEY = "theme"

export function resolveTheme(
	pref: ThemePref,
	systemDark: boolean,
): "light" | "dark" {
	if (pref === "system") {
		return systemDark ? "dark" : "light"
	}
	return pref
}

export function loadPref(): ThemePref {
	// Stored JSON-encoded, like every other setting, so the raw quotes have to
	// come off.
	let stored: unknown = null
	try {
		const raw = getSetting(STORAGE_KEY)
		stored = raw === null ? null : JSON.parse(raw)
	} catch {
		stored = null
	}
	return stored === "light" || stored === "dark" || stored === "system"
		? stored
		: "system"
}

export function useTheme() {
	const [pref, setPrefState] = useState<ThemePref>(loadPref)
	const [systemDark, setSystemDark] = useState(
		() => window.matchMedia("(prefers-color-scheme: dark)").matches,
	)

	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)")
		const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
		mq.addEventListener("change", onChange)
		return () => mq.removeEventListener("change", onChange)
	}, [])

	const resolved = resolveTheme(pref, systemDark)

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", resolved)
	}, [resolved])

	const setPref = useCallback((p: ThemePref) => {
		setSetting(STORAGE_KEY, JSON.stringify(p))
		setPrefState(p)
	}, [])

	return { pref, resolved, setPref }
}
