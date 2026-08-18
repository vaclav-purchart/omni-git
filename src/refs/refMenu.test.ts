import { describe, expect, it, vi } from "vitest"
import { buildRefMenu, localNameOf, type Ref } from "./refMenu"

const remote: Ref = { name: "origin/develop", tip: "h1", kind: "remote" }

function labels(items: ReturnType<typeof buildRefMenu>): string[] {
	return items.flatMap((i) => (i.type === "item" ? [i.label] : []))
}

function itemNamed(items: ReturnType<typeof buildRefMenu>, label: string) {
	const found = items.find((i) => i.type === "item" && i.label === label)
	expect(found, `no item labelled ${label}`).toBeDefined()
	return found as Extract<
		ReturnType<typeof buildRefMenu>[number],
		{ type: "item" }
	>
}

describe("localNameOf", () => {
	it("drops the remote, keeping the branch name", () => {
		expect(localNameOf("origin/develop")).toBe("develop")
	})

	// Branch names contain slashes far more often than remote names do, so only
	// the FIRST segment is the remote.
	it("keeps slashes inside the branch name", () => {
		expect(localNameOf("origin/feature/PROJ-12/api")).toBe(
			"feature/PROJ-12/api",
		)
	})

	it("leaves a bare name alone", () => {
		expect(localNameOf("develop")).toBe("develop")
	})
})

describe("a remote branch menu", () => {
	// The reported bug: "Checkout as Local Branch" fails once a local branch of
	// that name exists, and there was no way to bring the local one up to date.
	it("offers a sync action naming both branches", () => {
		const items = buildRefMenu(remote, {})

		expect(labels(items)).toContain("Sync develop from origin/develop")
	})

	it("syncs the ref that was clicked", () => {
		const onSyncFromRemote = vi.fn()

		const items = buildRefMenu(remote, { onSyncFromRemote })
		itemNamed(items, "Sync develop from origin/develop").onClick?.()

		expect(onSyncFromRemote).toHaveBeenCalledWith(remote)
	})

	// Separate from the sync, and marked dangerous: this one drops commits that
	// only the local branch had.
	it("offers a reset action, marked as dangerous", () => {
		const items = buildRefMenu(remote, {})

		const reset = itemNamed(items, "Reset develop to origin/develop…")
		expect(reset.danger).toBe(true)
	})

	it("resets the ref that was clicked", () => {
		const onResetToRemote = vi.fn()

		const items = buildRefMenu(remote, { onResetToRemote })
		itemNamed(items, "Reset develop to origin/develop…").onClick?.()

		expect(onResetToRemote).toHaveBeenCalledWith(remote)
	})

	// The trailing ellipsis is the app's convention for "this will ask first", and
	// the sync needs no confirmation because it cannot lose anything.
	it("promises a prompt only for the destructive one", () => {
		const items = buildRefMenu(remote, {})

		expect(labels(items)).toContain("Sync develop from origin/develop")
		expect(labels(items)).not.toContain("Sync develop from origin/develop…")
	})
})

describe("a local branch menu", () => {
	// Syncing is expressed on the remote ref, which is the thing being synced FROM.
	it("has no remote-sync actions", () => {
		const items = buildRefMenu(
			{ name: "develop", tip: "h1", kind: "local" },
			{},
		)

		expect(labels(items).filter((l) => l.startsWith("Sync "))).toEqual([])
		expect(labels(items).filter((l) => l.startsWith("Reset "))).toEqual([])
	})
})
