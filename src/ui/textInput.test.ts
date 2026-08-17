import { describe, expect, it } from "vitest"
import { NO_AUTOCORRECT } from "./textInput"

describe("NO_AUTOCORRECT", () => {
	// macOS enables all of these by default in a WKWebView. Autocorrect and
	// autocapitalise are the ones that actually corrupt input — a curly quote or a
	// capitalised first word ends up in permanent git history.
	it("turns off every macOS text assist", () => {
		expect(NO_AUTOCORRECT).toEqual({
			spellCheck: false,
			autoCorrect: "off",
			autoCapitalize: "off",
			autoComplete: "off",
		})
	})
})

/**
 * Every .tsx under src/, loaded as raw text.
 *
 * Vite's glob rather than node:fs, so the test needs no node type definitions and
 * resolves the same way the bundler does.
 */
const SOURCES = import.meta.glob("../**/*.tsx", {
	query: "?raw",
	eager: true,
	import: "default",
}) as Record<string, string>

describe("free-text inputs", () => {
	// A guard, not a style rule: it's easy to add an input and forget, and the
	// symptom (a smart quote in a commit message) shows up long after the fact.
	it("all opt out of autocorrect", () => {
		const offenders: string[] = []
		for (const [file, source] of Object.entries(SOURCES)) {
			if (file.includes(".test.")) {
				continue
			}
			// Each opening tag through to the end of its attributes.
			for (const match of source.matchAll(/<(input|textarea)\b[^>]*>/g)) {
				const tag = match[0]
				// Checkboxes and radios have nothing to autocorrect.
				if (/type="(checkbox|radio)"/.test(tag)) {
					continue
				}
				if (!tag.includes("{...NO_AUTOCORRECT}")) {
					offenders.push(`${file}: ${tag.slice(0, 60)}…`)
				}
			}
		}
		expect(offenders).toEqual([])
	})

	// The glob is the whole basis of the check above, so make sure it actually
	// found the files rather than silently matching nothing.
	it("scans the real sources", () => {
		const files = Object.keys(SOURCES).filter((f) => !f.includes(".test."))
		expect(files.length).toBeGreaterThan(20)
		expect(files.some((f) => f.endsWith("CommitBox.tsx"))).toBe(true)
	})
})
