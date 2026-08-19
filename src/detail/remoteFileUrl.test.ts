import { describe, expect, it } from "vitest"
import { webUrlFor } from "./remoteFileUrl"

const SHA = "0123456789abcdef0123456789abcdef01234567"

describe("webUrlFor", () => {
	// The form git writes for an ssh remote, and by far the most common one here.
	it("builds a GitHub blob URL from an scp-style ssh remote", () => {
		expect(
			webUrlFor(
				"git@github.com:FinshapeCZ/configurator.git",
				SHA,
				"src/app.ts",
			),
		).toBe(`https://github.com/FinshapeCZ/configurator/blob/${SHA}/src/app.ts`)
	})

	it("accepts an https remote, with or without the .git suffix", () => {
		const expected = `https://github.com/o/r/blob/${SHA}/a.ts`
		expect(webUrlFor("https://github.com/o/r.git", SHA, "a.ts")).toBe(expected)
		expect(webUrlFor("https://github.com/o/r", SHA, "a.ts")).toBe(expected)
	})

	// Credentials in the remote must never end up in a URL that gets sent to
	// someone else.
	it("strips credentials from the remote", () => {
		expect(
			webUrlFor("https://user:token@github.com/o/r.git", SHA, "a.ts"),
		).toBe(`https://github.com/o/r/blob/${SHA}/a.ts`)
	})

	it("accepts an ssh:// remote with a port", () => {
		expect(webUrlFor("ssh://git@github.com:22/o/r.git", SHA, "a.ts")).toBe(
			`https://github.com/o/r/blob/${SHA}/a.ts`,
		)
	})

	// Bitbucket names the same thing `src`, not `blob`.
	it("builds a Bitbucket src URL", () => {
		expect(
			webUrlFor("git@bitbucket.org:team/repo.git", SHA, "pkg/main.java"),
		).toBe(`https://bitbucket.org/team/repo/src/${SHA}/pkg/main.java`)
	})

	// bitbucket.com redirects to bitbucket.org, so the host is kept as-is and the
	// redirect resolves it — no need to rewrite what the user has configured.
	it("keeps the bitbucket.com host and uses the same shape", () => {
		expect(webUrlFor("git@bitbucket.com:team/repo.git", SHA, "a.ts")).toBe(
			`https://bitbucket.com/team/repo/src/${SHA}/a.ts`,
		)
	})

	// The full sha, never a short one or a branch: the link has to survive a later
	// force-push, since the whole point is sending it to someone else.
	it("uses the sha it was given verbatim", () => {
		const url = webUrlFor("git@github.com:o/r.git", SHA, "a.ts")
		expect(url).toContain(SHA)
	})

	it("keeps directory separators but encodes the segments", () => {
		expect(
			webUrlFor("git@github.com:o/r.git", SHA, "src/some dir/a b.ts"),
		).toBe(`https://github.com/o/r/blob/${SHA}/src/some%20dir/a%20b.ts`)
	})

	it("handles a path with a hash or question mark in it", () => {
		expect(webUrlFor("git@github.com:o/r.git", SHA, "a#b?c.ts")).toBe(
			`https://github.com/o/r/blob/${SHA}/a%23b%3Fc.ts`,
		)
	})

	// An unknown forge gets no URL rather than a guessed one that 404s. The caller
	// leaves the menu items out entirely.
	it("returns null for a host it has no shape for", () => {
		expect(
			webUrlFor("git@git.internal.example:o/r.git", SHA, "a.ts"),
		).toBeNull()
		expect(webUrlFor("git@gitlab.com:o/r.git", SHA, "a.ts")).toBeNull()
	})

	it("returns null for a remote it cannot parse", () => {
		expect(webUrlFor("", SHA, "a.ts")).toBeNull()
		expect(webUrlFor("git@github.com", SHA, "a.ts")).toBeNull()
		expect(webUrlFor("/local/path/repo.git", SHA, "a.ts")).toBeNull()
	})

	it("returns null without a sha or a path", () => {
		expect(webUrlFor("git@github.com:o/r.git", "", "a.ts")).toBeNull()
		expect(webUrlFor("git@github.com:o/r.git", SHA, "")).toBeNull()
	})
})
