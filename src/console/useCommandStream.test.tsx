import { act, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useCommandStream } from "./useCommandStream"

// A tiny event bus standing in for Tauri's, so tests can push chunks at the
// hook the way the backend would.
type Listener<T> = (e: { payload: T }) => void
const chunkListeners: Array<Listener<ChunkPayload>> = []
const doneListeners: Array<Listener<DonePayload>> = []
type ChunkPayload = { run_id: string; stderr: boolean; text: string }
type DonePayload = { run_id: string; exit_code: number }

vi.mock("../ipc/bindings", () => ({
	events: {
		commandChunk: {
			listen: (fn: Listener<ChunkPayload>) => {
				chunkListeners.push(fn)
				return Promise.resolve(() => {
					chunkListeners.splice(chunkListeners.indexOf(fn), 1)
				})
			},
		},
		commandDone: {
			listen: (fn: Listener<DonePayload>) => {
				doneListeners.push(fn)
				return Promise.resolve(() => {
					doneListeners.splice(doneListeners.indexOf(fn), 1)
				})
			},
		},
	},
}))

function emitChunk(p: ChunkPayload) {
	act(() => {
		for (const fn of [...chunkListeners]) {
			fn({ payload: p })
		}
	})
}

function emitDone(p: DonePayload) {
	act(() => {
		for (const fn of [...doneListeners]) {
			fn({ payload: p })
		}
	})
}

let api: ReturnType<typeof useCommandStream>

function Harness() {
	api = useCommandStream()
	return (
		<div>
			<span data-testid="status">{api.result?.status ?? "none"}</span>
			<span data-testid="title">{api.result?.title ?? ""}</span>
			<pre data-testid="output">{api.result?.output ?? ""}</pre>
		</div>
	)
}

const status = () => screen.getByTestId("status").textContent
const title = () => screen.getByTestId("title").textContent
const output = () => screen.getByTestId("output").textContent

const LABELS = { running: "Committing…", ok: "Committed", error: "Rejected" }

async function beginRun(labels = LABELS) {
	let id = ""
	act(() => {
		id = api.begin(labels)
	})
	// Let the listen() promises resolve so the subscriptions are live.
	await act(async () => {})
	return id
}

beforeEach(() => {
	chunkListeners.length = 0
	doneListeners.length = 0
})

describe("useCommandStream", () => {
	it("starts with nothing shown", async () => {
		render(<Harness />)
		await act(async () => {})

		expect(status()).toBe("none")
	})

	// The point of the whole change: output appears while the command runs,
	// not in one dump after it exits.
	it("appends chunks as they arrive, before the command finishes", async () => {
		render(<Harness />)
		const runId = await beginRun()

		expect(status()).toBe("running")
		expect(title()).toBe("Committing…")

		emitChunk({ run_id: runId, stderr: false, text: "lefthook: " })
		expect(output()).toBe("lefthook: ")

		emitChunk({ run_id: runId, stderr: false, text: "lint-staged…" })
		expect(output()).toBe("lefthook: lint-staged…")
		// still running: only commandDone may finalise it
		expect(status()).toBe("running")
	})

	it("finalises as success on exit 0, swapping in the success label", async () => {
		render(<Harness />)
		const runId = await beginRun()
		emitChunk({ run_id: runId, stderr: false, text: "[main abc] done" })

		emitDone({ run_id: runId, exit_code: 0 })

		expect(status()).toBe("ok")
		expect(title()).toBe("Committed")
		expect(output()).toBe("[main abc] done")
	})

	it("finalises as error on a non-zero exit", async () => {
		render(<Harness />)
		const runId = await beginRun()

		emitDone({ run_id: runId, exit_code: 1 })

		expect(status()).toBe("error")
		expect(title()).toBe("Rejected")
	})

	// stderr and stdout interleave into one transcript, as they would in a
	// terminal — hooks write diagnostics to both.
	it("merges both streams into one transcript", async () => {
		render(<Harness />)
		const runId = await beginRun()

		emitChunk({ run_id: runId, stderr: false, text: "out " })
		emitChunk({ run_id: runId, stderr: true, text: "err" })

		expect(output()).toBe("out err")
	})

	// A previous slow command must not bleed into the panel showing a new one.
	it("ignores chunks from a run it is not showing", async () => {
		render(<Harness />)
		const first = await beginRun()
		const second = await beginRun()
		expect(first).not.toBe(second)

		emitChunk({ run_id: first, stderr: false, text: "STALE" })
		emitChunk({ run_id: second, stderr: false, text: "current" })

		expect(output()).toBe("current")
	})

	it("ignores a done event from a run it is not showing", async () => {
		render(<Harness />)
		const first = await beginRun()
		const second = await beginRun()

		emitDone({ run_id: first, exit_code: 1 })

		// the current run is unaffected by the abandoned one
		expect(status()).toBe("running")
		expect(second).not.toBe(first)
	})

	it("shows a non-streamed result directly", async () => {
		render(<Harness />)
		await act(async () => {})

		act(() => {
			api.show({
				title: "Could not run git commit",
				output: "fatal: not a git repository",
				status: "error",
			})
		})

		expect(status()).toBe("error")
		expect(output()).toBe("fatal: not a git repository")
	})

	// After close, late chunks from the abandoned run must not resurrect it.
	it("stops tracking a run once closed", async () => {
		render(<Harness />)
		const runId = await beginRun()

		act(() => {
			api.close()
		})
		emitChunk({ run_id: runId, stderr: false, text: "late" })

		expect(status()).toBe("none")
	})

	describe("closeIfFinished", () => {
		// Navigating somewhere that wants the panel back should replace finished
		// output rather than leaving it there.
		it("dismisses a finished result", async () => {
			render(<Harness />)
			const runId = await beginRun()
			emitDone({ run_id: runId, exit_code: 0 })
			expect(status()).toBe("ok")

			act(() => {
				api.closeIfFinished()
			})

			expect(status()).toBe("none")
		})

		it("dismisses a failed result too", async () => {
			render(<Harness />)
			const runId = await beginRun()
			emitDone({ run_id: runId, exit_code: 1 })

			act(() => {
				api.closeIfFinished()
			})

			expect(status()).toBe("none")
		})

		// A live process must not vanish because a row was clicked.
		it("leaves a running command alone", async () => {
			render(<Harness />)
			await beginRun()
			expect(status()).toBe("running")

			act(() => {
				api.closeIfFinished()
			})

			expect(status()).toBe("running")
		})

		it("does nothing when there is no output", async () => {
			render(<Harness />)
			await act(async () => {})

			act(() => {
				api.closeIfFinished()
			})

			expect(status()).toBe("none")
		})

		// Escape and the close button still work on a running command.
		it("close() still dismisses a running command", async () => {
			render(<Harness />)
			await beginRun()

			act(() => {
				api.close()
			})

			expect(status()).toBe("none")
		})
	})
})
