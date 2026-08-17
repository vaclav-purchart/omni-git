// A changed file is "test-ish" (lower review priority) when its FILENAME
// contains a dotted .test. or .spec. segment — matches foo.test.ts,
// Bar.spec.tsx; not directories named test/ or files like contest.ts.
export function isTestFile(path: string): boolean {
	const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
	return name.includes(".test.") || name.includes(".spec.")
}
