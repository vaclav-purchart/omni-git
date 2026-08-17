import { describe, expect, it } from "vitest"
import { resolveTheme } from "./useTheme"

describe("resolveTheme", () => {
	it("follows system when pref is system", () => {
		expect(resolveTheme("system", true)).toBe("dark")
		expect(resolveTheme("system", false)).toBe("light")
	})

	it("honors explicit overrides regardless of system", () => {
		expect(resolveTheme("light", true)).toBe("light")
		expect(resolveTheme("dark", false)).toBe("dark")
	})
})
