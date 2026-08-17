import { describe, expect, it } from "vitest"
import { formatRelative } from "./time"

const NOW = 1_700_000_000_000

describe("formatRelative", () => {
	it("says 'just now' under a minute", () => {
		expect(formatRelative(NOW - 30_000, NOW)).toBe("just now")
	})
	it("uses minutes under an hour", () => {
		expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe("5m ago")
	})
	it("uses hours under a day", () => {
		expect(formatRelative(NOW - 3 * 3_600_000, NOW)).toBe("3h ago")
	})
	it("uses days under a week", () => {
		expect(formatRelative(NOW - 2 * 86_400_000, NOW)).toBe("2d ago")
	})
	it("falls back to an ISO date beyond a week", () => {
		const ts = Date.UTC(2023, 0, 15) // 2023-01-15
		expect(formatRelative(ts, ts + 30 * 86_400_000)).toBe("2023-01-15")
	})
})
