import { isTestFile } from "./fileClass"

export type FileFilter = {
	id: string
	pattern: string
	mode: "hide" | "highlight"
	enabled: boolean
}

function globToRegExp(glob: string): RegExp {
	let re = ""
	let i = 0
	while (i < glob.length) {
		const c = glob[i]
		if (c === "*") {
			if (glob[i + 1] === "*") {
				re += ".*"
				i += 2
				continue
			}
			re += "[^/]*"
			i += 1
			continue
		}
		if (c === "?") {
			re += "[^/]"
			i += 1
			continue
		}
		re += c.replace(/[.+^${}()|[\]\\]/, "\\$&")
		i += 1
	}
	return new RegExp(`^${re}$`, "i")
}

export function matchFilePattern(pattern: string, path: string): boolean {
	const p = pattern.trim()
	if (p === "") {
		return false
	}
	const target = p.includes("/") ? path : (path.split("/").pop() ?? path)
	return globToRegExp(p).test(target)
}

export function fileFlags(
	path: string,
	filters: FileFilter[],
): { hidden: boolean; highlighted: boolean } {
	let hidden = false
	let highlighted = false
	for (const f of filters) {
		if (!f.enabled || !matchFilePattern(f.pattern, path)) {
			continue
		}
		if (f.mode === "hide") {
			hidden = true
		} else {
			highlighted = true
		}
	}
	return { hidden, highlighted }
}

export function applyFileFilters<T extends { path: string }>(
	files: T[],
	filters: FileFilter[],
	hideTests: boolean,
): { visible: T[]; highlighted: Set<string>; testCount: number } {
	const visible: T[] = []
	const highlighted = new Set<string>()
	let testCount = 0
	for (const f of files) {
		const isTest = isTestFile(f.path)
		if (isTest) {
			testCount += 1
		}
		const flags = fileFlags(f.path, filters)
		if (flags.hidden || (hideTests && isTest)) {
			continue
		}
		visible.push(f)
		if (flags.highlighted) {
			highlighted.add(f.path)
		}
	}
	return { visible, highlighted, testCount }
}
