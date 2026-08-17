// Git subcommands offered for completion. Curated rather than exhaustive: these
// are the ones worth typing in a GUI, and a short list keeps the suggestions
// useful instead of a wall of plumbing commands. Anything absent still runs —
// completion is a convenience, not a whitelist.
export const GIT_SUBCOMMANDS = [
	"add",
	"bisect",
	"blame",
	"branch",
	"checkout",
	"cherry-pick",
	"clean",
	"commit",
	"config",
	"describe",
	"diff",
	"fetch",
	"gc",
	"grep",
	"log",
	"merge",
	"mv",
	"pull",
	"push",
	"rebase",
	"reflog",
	"remote",
	"reset",
	"restore",
	"revert",
	"rm",
	"show",
	"stash",
	"status",
	"switch",
	"tag",
	"worktree",
]

/** What the word under the cursor should be completed against. */
export type CompletionKind = "subcommand" | "ref"

export type CompletionContext = {
	kind: CompletionKind
	/** The partial word being completed (may be empty). */
	prefix: string
	/** Index in the input where that word starts. */
	start: number
}

/**
 * Where the last word starts, and what it is.
 *
 * Only the word the caret is at the end of gets completed — the palette input is
 * a single line typed left to right, so this stays simple deliberately. The
 * FIRST word completes to a subcommand, any later one to a ref: `checkout ma`
 * wants branches, not subcommands.
 *
 * A leading `git` is skipped so `git checkout ma` behaves like `checkout ma`,
 * matching the backend, which also accepts either form.
 */
export function completionContext(input: string): CompletionContext {
	const start = lastWordStart(input)
	const prefix = input.slice(start)
	const before = input.slice(0, start).trim()
	const words = before === "" ? [] : before.split(/\s+/)
	const meaningful = words[0] === "git" ? words.slice(1) : words
	return {
		kind: meaningful.length === 0 ? "subcommand" : "ref",
		prefix,
		start,
	}
}

function lastWordStart(input: string): number {
	for (let i = input.length - 1; i >= 0; i--) {
		if (/\s/.test(input[i])) {
			return i + 1
		}
	}
	return 0
}

/**
 * Candidates for a context, prefix-matched and case-insensitive.
 *
 * Refs are matched on their tail as well as their head, so `13723` finds
 * `fix/P20009663-13723-…` — with branch names like that, requiring the prefix
 * would make completion useless. Head matches sort first, since that's what the
 * user most likely meant.
 */
export function completionCandidates(
	ctx: CompletionContext,
	options: { refs: string[] },
): string[] {
	const pool = ctx.kind === "subcommand" ? GIT_SUBCOMMANDS : options.refs
	const p = ctx.prefix.toLowerCase()
	if (p === "") {
		return [...pool]
	}
	const head: string[] = []
	const tail: string[] = []
	for (const c of pool) {
		const lower = c.toLowerCase()
		if (lower.startsWith(p)) {
			head.push(c)
		} else if (ctx.kind === "ref" && lower.includes(p)) {
			tail.push(c)
		}
	}
	return [...head, ...tail]
}

/** The longest prefix shared by every candidate, or "" if they diverge at once. */
export function longestCommonPrefix(values: string[]): string {
	if (values.length === 0) {
		return ""
	}
	let prefix = values[0]
	for (const v of values.slice(1)) {
		let i = 0
		while (i < prefix.length && i < v.length && prefix[i] === v[i]) {
			i++
		}
		prefix = prefix.slice(0, i)
		if (prefix === "") {
			break
		}
	}
	return prefix
}

/**
 * Replaces the word being completed with `candidate`.
 *
 * A trailing space is added only for a finished word, so TAB-ing to a unique
 * match leaves the caret ready for the next argument, while accepting a partial
 * common prefix doesn't strand it.
 */
export function applyCompletion(
	input: string,
	ctx: CompletionContext,
	candidate: string,
	finished: boolean,
): string {
	return input.slice(0, ctx.start) + candidate + (finished ? " " : "")
}
