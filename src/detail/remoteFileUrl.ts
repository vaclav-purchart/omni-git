/**
 * Turns a git remote into a browsable web URL for one file at one commit — the
 * kind of link you send someone else.
 *
 * Pure and forge-specific by design. There is no way to derive the URL shape from
 * a remote: every forge invents its own, and the host is the only clue. So the
 * shapes are listed explicitly and anything unrecognised yields null, which the
 * caller reads as "leave the menu items out" — a guessed URL that 404s is worse
 * than no URL, because the person you sent it to is the one who finds out.
 */

/** How a forge spells "this file, at this commit". */
type Shape = (repo: string, sha: string, path: string) => string

const SHAPES: Record<string, Shape> = {
	"github.com": (repo, sha, path) => `${repo}/blob/${sha}/${path}`,
	// bitbucket.com redirects to bitbucket.org, so both are Bitbucket Cloud and
	// the configured host is kept rather than rewritten.
	"bitbucket.org": (repo, sha, path) => `${repo}/src/${sha}/${path}`,
	"bitbucket.com": (repo, sha, path) => `${repo}/src/${sha}/${path}`,
}

/** `host` and `owner/repo`, from any of the forms git accepts as a remote. */
function parseRemote(remote: string): { host: string; repo: string } | null {
	const trimmed = remote.trim()
	if (trimmed === "") {
		return null
	}
	// scp-style: [user@]host:owner/repo(.git). Distinguished from a URL by having
	// no scheme, and from a plain path by having a colon after the host.
	const scp = trimmed.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/)
	if (scp && !trimmed.includes("://")) {
		return clean(scp[1], scp[2])
	}
	// ssh://, https://, git:// — the URL parser handles credentials and ports.
	try {
		const url = new URL(trimmed)
		return clean(url.hostname, url.pathname)
	} catch {
		return null
	}
}

function clean(
	host: string,
	path: string,
): { host: string; repo: string } | null {
	const repo = path
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.git$/, "")
	// Every shape here needs at least an owner and a repo.
	if (host === "" || !repo.includes("/")) {
		return null
	}
	return { host, repo }
}

/**
 * The web URL for `path` as it stood at `sha`, or null if one cannot be built.
 *
 * `sha` is used verbatim and should be the full hash: the link has to keep working
 * after a branch moves or is force-pushed.
 */
export function webUrlFor(
	remote: string,
	sha: string,
	path: string,
): string | null {
	if (sha === "" || path === "") {
		return null
	}
	const parsed = parseRemote(remote)
	if (parsed === null) {
		return null
	}
	const shape = SHAPES[parsed.host]
	if (shape === undefined) {
		return null
	}
	// Per segment: the separators are structure, everything else is a name that
	// may contain spaces, `#` or `?`.
	const encoded = path.split("/").map(encodeURIComponent).join("/")
	return `https://${parsed.host}/${shape(parsed.repo, sha, encoded)}`
}
