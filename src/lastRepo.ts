import type { Repo } from "./ipc/bindings"
import { getSetting, removeSetting, setSetting } from "./settings/settings"

const LAST_REPO_KEY = "last-repo"

/**
 * What was found in settings about the repo to reopen.
 *
 * `repo` — the whole thing, so the workspace can render on the FIRST paint with
 * no IPC round-trip. That's what stops the launcher appearing and then being
 * replaced: previously only an id was stored, so the target screen wasn't known
 * until `list_repos` came back.
 *
 * `id` — the legacy format (an id alone). Still has to be looked up, so those
 * users get one more slow start until they next open a repo and it's rewritten.
 */
export type LastRepo =
	| { kind: "repo"; repo: Repo }
	| { kind: "id"; id: string }
	| null

/** Parses a stored value. Exported for tests; prefer `readLastRepo`. */
export function parseLastRepo(raw: string | null): LastRepo {
	if (raw === null) {
		return null
	}
	let value: unknown
	try {
		value = JSON.parse(raw)
	} catch {
		return null
	}
	if (typeof value === "string") {
		return value === "" ? null : { kind: "id", id: value }
	}
	if (value !== null && typeof value === "object") {
		const r = value as Partial<Repo>
		// All three are needed to open a workspace; anything less is unusable, so
		// treat it as absent rather than rendering a half-broken repo.
		if (
			typeof r.id === "string" &&
			typeof r.name === "string" &&
			typeof r.path === "string"
		) {
			return { kind: "repo", repo: { id: r.id, name: r.name, path: r.path } }
		}
	}
	return null
}

export function readLastRepo(): LastRepo {
	try {
		return parseLastRepo(getSetting(LAST_REPO_KEY))
	} catch {
		return null
	}
}

export function writeLastRepo(repo: Repo): void {
	setSetting(LAST_REPO_KEY, JSON.stringify(repo))
}

export function clearLastRepo(): void {
	removeSetting(LAST_REPO_KEY)
}
