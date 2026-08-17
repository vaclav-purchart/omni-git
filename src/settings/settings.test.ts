import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	flushSettings,
	getSetting,
	initSettings,
	panelStorage,
	removeSetting,
	__resetSettingsForTests as resetSettings,
	setSetting,
} from "./settings"

const { loadSettings, saveSettings } = vi.hoisted(() => ({
	loadSettings: vi.fn(),
	saveSettings: vi.fn(),
}))

vi.mock("../ipc/bindings", () => ({
	commands: { loadSettings, saveSettings },
}))

beforeEach(() => {
	resetSettings()
	loadSettings.mockReset()
	saveSettings.mockReset()
	saveSettings.mockResolvedValue({ status: "ok", data: null })
})

describe("initSettings", () => {
	it("loads what the backend returns", async () => {
		loadSettings.mockResolvedValue({
			status: "ok",
			data: { theme: '"dark"', scope: '"all"' },
		})

		await initSettings()

		expect(getSetting("theme")).toBe('"dark"')
		expect(getSetting("scope")).toBe('"all"')
	})

	// A settings failure must never stop the app from starting; the session just
	// runs on defaults.
	it("falls back to empty settings when loading fails", async () => {
		loadSettings.mockResolvedValue({
			status: "error",
			error: { kind: "Io", message: "corrupt" },
		})

		await initSettings()

		expect(getSetting("theme")).toBeNull()
	})

	it("survives the command throwing outright", async () => {
		loadSettings.mockRejectedValue(new Error("no IPC"))

		await expect(initSettings()).resolves.toBeUndefined()
		expect(getSetting("theme")).toBeNull()
	})

	// The generated binding types map values as possibly-undefined.
	it("ignores non-string values", async () => {
		loadSettings.mockResolvedValue({
			status: "ok",
			data: { good: '"x"', bad: undefined },
		})

		await initSettings()

		expect(getSetting("good")).toBe('"x"')
		expect(getSetting("bad")).toBeNull()
	})
})

describe("reads and writes", () => {
	// Synchronous reads are the point: the startup path decides which screen to
	// show without awaiting IPC.
	it("reads back a value synchronously, with no await", () => {
		setSetting("theme", '"dark"')

		expect(getSetting("theme")).toBe('"dark"')
	})

	it("returns null for an unknown key", () => {
		expect(getSetting("nope")).toBeNull()
	})

	it("removes a value", () => {
		setSetting("theme", '"dark"')

		removeSetting("theme")

		expect(getSetting("theme")).toBeNull()
	})

	it("distinguishes a stored empty string from absent", () => {
		setSetting("k", '""')

		expect(getSetting("k")).toBe('""')
	})
})

describe("persistence", () => {
	it("writes the whole map to the backend", async () => {
		setSetting("a", "1")
		setSetting("b", "2")

		await flushSettings()

		expect(saveSettings).toHaveBeenCalledWith({ a: "1", b: "2" })
	})

	// Rapid changes (a panel drag) must collapse into one write.
	it("coalesces several changes into a single write", async () => {
		setSetting("a", "1")
		setSetting("a", "2")
		setSetting("a", "3")

		await flushSettings()

		expect(saveSettings).toHaveBeenCalledTimes(1)
		expect(saveSettings).toHaveBeenCalledWith({ a: "3" })
	})

	it("does not write when nothing changed", async () => {
		await flushSettings()

		expect(saveSettings).not.toHaveBeenCalled()
	})

	it("does not write when a value is set to what it already was", async () => {
		setSetting("a", "1")
		await flushSettings()
		saveSettings.mockClear()

		setSetting("a", "1")
		await flushSettings()

		expect(saveSettings).not.toHaveBeenCalled()
	})

	// Losing a UI preference isn't worth an error dialog.
	it("swallows a failed write", async () => {
		saveSettings.mockRejectedValue(new Error("disk full"))
		setSetting("a", "1")

		await expect(flushSettings()).resolves.toBeUndefined()
	})

	it("eventually writes on its own, without an explicit flush", async () => {
		vi.useFakeTimers()
		try {
			setSetting("a", "1")
			expect(saveSettings).not.toHaveBeenCalled()

			await vi.advanceTimersByTimeAsync(500)

			expect(saveSettings).toHaveBeenCalledWith({ a: "1" })
		} finally {
			vi.useRealTimers()
		}
	})
})

describe("panelStorage", () => {
	// react-resizable-panels would otherwise write layouts straight to
	// localStorage, which is exactly what we moved away from.
	it("namespaces panel layouts and round-trips them", () => {
		panelStorage.setItem("omni-ws-outer", "[50,50]")

		expect(panelStorage.getItem("omni-ws-outer")).toBe("[50,50]")
		expect(getSetting("panels.omni-ws-outer")).toBe("[50,50]")
	})

	it("returns null for an unseen layout", () => {
		expect(panelStorage.getItem("never-used")).toBeNull()
	})
})
