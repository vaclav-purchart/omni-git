export type CommitFilter = { query: string; author: string }
type Matchable = { subject: string; author_name: string; hash: string }

export function isFilterActive(filter: CommitFilter): boolean {
	return filter.query.trim() !== "" || filter.author.trim() !== ""
}

export function commitMatches(
	commit: Matchable,
	filter: CommitFilter,
): boolean {
	const q = filter.query.trim().toLowerCase()
	const a = filter.author.trim().toLowerCase()
	const queryOk =
		q === "" ||
		commit.subject.toLowerCase().includes(q) ||
		commit.hash.toLowerCase().includes(q)
	const authorOk = a === "" || commit.author_name.toLowerCase().includes(a)
	return queryOk && authorOk
}

export function findMatches(
	commits: Matchable[],
	filter: CommitFilter,
): number[] {
	if (!isFilterActive(filter)) {
		return []
	}
	const out: number[] = []
	for (let i = 0; i < commits.length; i++) {
		if (commitMatches(commits[i], filter)) {
			out.push(i)
		}
	}
	return out
}
