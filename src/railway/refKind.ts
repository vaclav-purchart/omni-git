export type RefKind = "head" | "local" | "remote" | "tag"
export type ParsedRef = { kind: RefKind; label: string; isHead: boolean }

/**
 * Whether this commit is the one `HEAD` points at — the repo's ACTUAL state,
 * as opposed to whichever row the user happens to have selected.
 *
 * Read straight from git's own `%D` decorations, which carry `HEAD -> <branch>`
 * when attached and a bare `HEAD` when detached. No extra command needed.
 */
export function isHeadCommit(refs: string[]): boolean {
	return refs.some((r) => parseRef(r).isHead)
}

/**
 * The branch `HEAD` is attached to, from git's own decorations, or `null` when
 * detached (a bare `HEAD`) or when this commit isn't HEAD at all.
 *
 * Lets the working-copy row say which branch the uncommitted changes are on
 * without another git call.
 */
export function headBranchName(refs: string[]): string | null {
	for (const r of refs) {
		const parsed = parseRef(r)
		if (parsed.isHead && parsed.kind === "local") {
			return parsed.label
		}
	}
	return null
}

export function parseRef(decoration: string): ParsedRef {
	let isHead = false
	let ref = decoration.trim()
	if (ref.startsWith("HEAD -> ")) {
		isHead = true
		ref = ref.slice("HEAD -> ".length)
	}
	if (ref === "HEAD") {
		return { kind: "head", label: "HEAD", isHead: true }
	}
	if (ref.startsWith("tag: ")) {
		const full = ref.slice("tag: ".length)
		return { kind: "tag", label: full.replace(/^refs\/tags\//, ""), isHead }
	}
	if (ref.startsWith("refs/remotes/")) {
		return { kind: "remote", label: ref.slice("refs/remotes/".length), isHead }
	}
	if (ref.startsWith("refs/heads/")) {
		return { kind: "local", label: ref.slice("refs/heads/".length), isHead }
	}
	return { kind: "local", label: ref, isHead }
}
