import { useCallback, useState } from "react"
import { getSetting, setSetting } from "../settings/settings"

// useState that mirrors its value into the on-disk settings file (see
// settings.ts), so it survives app rebuilds and the dev/bundled origin switch
// that localStorage did not. Reads are synchronous — settings are loaded before
// the first render. Defensive parse → falls back to `initial`.
export function usePersistentState<T>(
	key: string,
	initial: T,
): [T, (v: T | ((prev: T) => T)) => void] {
	const [value, setValue] = useState<T>(() => {
		try {
			const raw = getSetting(key)
			return raw === null ? initial : (JSON.parse(raw) as T)
		} catch {
			return initial
		}
	})
	const set = useCallback(
		(v: T | ((prev: T) => T)) => {
			setValue((prev) => {
				const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v
				try {
					setSetting(key, JSON.stringify(next))
				} catch {}
				return next
			})
		},
		[key],
	)
	return [value, set]
}
