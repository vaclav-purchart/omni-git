/**
 * Whether a patch is git's "this file is binary" placeholder rather than a diff.
 *
 * Git calls a file binary when it finds a NUL in the first 8000 bytes, which
 * catches ordinary source files that merely contain one in a string literal —
 * e.g. `parts.join('\0')` written with a real NUL. For those the patch body is a
 * single line like `Binary files a/x.ts and b/x.ts differ`, which rendered in the
 * diff view looks like a broken diff rather than an explanation.
 *
 * Matched on the line, not with `includes`, so a diff that merely CONTAINS that
 * text (say, a test fixture asserting on git's output) isn't mistaken for one.
 */
export function isBinaryPatch(diff: string): boolean {
	return diff.split("\n").some((line) => {
		const l = line.trimEnd()
		return (
			(l.startsWith("Binary files ") && l.endsWith(" differ")) ||
			l === "GIT binary patch"
		)
	})
}
