import { beforeEach, describe, expect, it, vi } from "vitest"
import type { MenuItem } from "../ui/ContextMenu"
import { remoteFileItems } from "./remoteFileMenu"

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }))

const URL = "https://github.com/o/r/blob/abc/src/a.ts"

function item(items: MenuItem[], label: string) {
	const found = items.find((i) => i.type === "item" && i.label === label)
	expect(found, `no item labelled ${label}`).toBeDefined()
	return found as Extract<MenuItem, { type: "item" }>
}

const writeText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
	openUrl.mockClear()
	writeText.mockClear()
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText },
		configurable: true,
	})
})

describe("remoteFileItems", () => {
	// No URL means the forge is unknown or there is no remote. Better to offer
	// nothing than an item that cannot work.
	it("offers nothing without a URL", () => {
		expect(remoteFileItems({ url: null, pushed: true })).toEqual([])
	})

	it("offers copy and open, in that order", () => {
		const items = remoteFileItems({ url: URL, pushed: true })

		expect(items.map((i) => (i.type === "item" ? i.label : "—"))).toEqual([
			"Copy remote file URL",
			"Open remote file URL",
		])
	})

	it("copies the URL", async () => {
		const items = remoteFileItems({ url: URL, pushed: true })

		item(items, "Copy remote file URL").onClick?.()

		expect(writeText).toHaveBeenCalledWith(URL)
	})

	it("opens the URL in the browser", () => {
		const items = remoteFileItems({ url: URL, pushed: true })

		item(items, "Open remote file URL").onClick?.()

		expect(openUrl).toHaveBeenCalledWith(URL)
	})

	// The failure worth preventing: a link to a commit that only exists locally
	// 404s, and the person it was sent to is the one who finds out. Say so before
	// the click rather than after.
	it("disables both, and says why, when the commit is not pushed", () => {
		const items = remoteFileItems({ url: URL, pushed: false })

		for (const i of items) {
			expect(i.type === "item" && i.disabled).toBe(true)
			expect(i.type === "item" && i.label).toMatch(/not pushed/i)
		}
	})

	it("does nothing at all when clicked while not pushed", () => {
		const items = remoteFileItems({ url: URL, pushed: false })

		for (const i of items) {
			if (i.type === "item") {
				i.onClick?.()
			}
		}

		expect(writeText).not.toHaveBeenCalled()
		expect(openUrl).not.toHaveBeenCalled()
	})

	// The check is asynchronous, so the menu can open before the answer arrives.
	// Staying enabled is the right bet: the common case is a pushed commit, and
	// the cost of being wrong is one 404 rather than an action you cannot take.
	it("stays usable while the check is still in flight", () => {
		const items = remoteFileItems({ url: URL, pushed: null })

		expect(items).toHaveLength(2)
		for (const i of items) {
			expect(i.type === "item" && i.disabled).toBeFalsy()
		}
	})
})
