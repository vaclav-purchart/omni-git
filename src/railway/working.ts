import type { CommitSummary } from "../ipc/bindings"

export const WORKING_HASH = "__WORKING_COPY__"

export type WorkingCounts = {
	staged: number
	unstaged: number
	untracked: number
}

// The working node is pinned above the commit list (outside the graph), so it
// carries no graph-relevant fields (no parents, no timestamp) — it's a static
// placeholder for the "Uncommitted changes" row, identified solely by
// `WORKING_HASH`.
export function makeWorkingNode(): CommitSummary {
	return {
		hash: WORKING_HASH,
		parents: [],
		author_name: "",
		author_email: "",
		timestamp_ms: 0,
		refs: [],
		subject: "Uncommitted changes",
	}
}
