import type { Repo } from "../ipc/bindings"

export function filterRepos(repos: Repo[], query: string): Repo[] {
	const q = query.trim().toLowerCase()
	if (q === "") {
		return repos
	}
	return repos.filter(
		(r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
	)
}
