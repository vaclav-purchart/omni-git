import type { MenuItem } from "../ui/ContextMenu"

export type Ref = {
	name: string
	tip: string
	kind: "local" | "remote" | "tag"
}

/**
 * Everything a ref menu can do. The operations themselves run in the workspace,
 * which owns the output panel and the dialogs; a menu only says which ref was
 * acted on.
 */
export type RefActions = {
	onCheckout?: (ref: Ref) => void
	onCreateBranch?: (startPoint: string) => void
	onDiffRef?: (ref: Ref) => void
	onDeleteRef?: (ref: Ref, force: boolean) => void
	/** Fast-forward the local branch of the same name. Cannot lose work. */
	onSyncFromRemote?: (ref: Ref) => void
	/** Move the local branch onto the remote, discarding local-only commits. */
	onResetToRemote?: (ref: Ref) => void
}

/**
 * The local branch name a remote-tracking ref corresponds to: `origin/develop` is
 * the remote's view of `develop`.
 *
 * Only the FIRST segment is dropped. Remote names cannot contain a slash, while
 * branch names contain them constantly (`feature/PROJ-12/api`), so splitting on
 * the last slash — or on every slash — would mangle the common case.
 */
export function localNameOf(remoteRef: string): string {
	const slash = remoteRef.indexOf("/")
	return slash === -1 ? remoteRef : remoteRef.slice(slash + 1)
}

/**
 * The right-click menu for a branch or tag, per the context-menus design spec.
 *
 * Copy-name sits near the TOP rather than at the bottom. It is one of the few
 * actions that actually works, and it was previously buried under a dozen
 * disabled WIP entries — far enough down to read as missing.
 * Wired actions are checkout, create-branch, diff-against-current, delete and
 * copy-name; the rest is scaffolded as disabled WIP items.
 *
 * Shared rather than built per call site: the same ref is right-clickable in the
 * sidebar and as a badge on a commit row, and two copies of this list would
 * drift the moment one of the WIP items got implemented.
 *
 * The item set is entity-specific. Local branches get the full git-flow menu,
 * tags only the actions that make sense for an immutable pointer, and remote
 * branches drop what doesn't apply to a read-only remote-tracking ref
 * (merge/rebase/push/track).
 */
export function buildRefMenu(ref: Ref, actions: RefActions): MenuItem[] {
	const {
		onCheckout,
		onCreateBranch,
		onDiffRef,
		onDeleteRef,
		onSyncFromRemote,
		onResetToRemote,
	} = actions

	const diffAgainstCurrent: MenuItem = {
		type: "item",
		label: "Diff Against Current",
		onClick: () => onDiffRef?.(ref),
	}
	const copyName = (label: string): MenuItem => ({
		type: "item",
		label,
		onClick: () => navigator.clipboard?.writeText(ref.name).catch(() => {}),
	})
	const createBranchHere: MenuItem = {
		type: "item",
		label: "Create Branch Here…",
		onClick: () => onCreateBranch?.(ref.name),
	}

	if (ref.kind === "tag") {
		return [
			{
				type: "item",
				// A tag isn't a branch, so this detaches HEAD — said out loud, because
				// arriving in a detached HEAD unannounced is how people lose commits.
				label: `Checkout ${ref.name} (detached)`,
				onClick: () => onCheckout?.(ref),
			},
			createBranchHere,
			copyName("Copy Tag Name to Clipboard"),
			{ type: "separator" },
			diffAgainstCurrent,
			{ type: "separator" },
			{ type: "item", label: `Delete ${ref.name}`, wip: true, danger: true },
		]
	}

	if (ref.kind === "remote") {
		const local = localNameOf(ref.name)
		return [
			{
				type: "item",
				label: "Checkout as Local Branch",
				onClick: () => onCheckout?.(ref),
			},
			{
				// No ellipsis: fast-forward only, so there is nothing to warn about. It
				// either advances the local branch or git refuses and says why.
				type: "item",
				label: `Sync ${local} from ${ref.name}`,
				onClick: () => onSyncFromRemote?.(ref),
			},
			createBranchHere,
			copyName("Copy Remote Branch Name to Clipboard"),
			{ type: "item", label: `Fetch ${ref.name}`, wip: true },
			{ type: "separator" },
			diffAgainstCurrent,
			{ type: "separator" },
			{
				// Grouped with the deletions, not with the sync above: this is the one
				// action here that can drop commits, so it belongs among the dangerous
				// items rather than one mis-click from a safe one.
				type: "item",
				label: `Reset ${local} to ${ref.name}…`,
				danger: true,
				onClick: () => onResetToRemote?.(ref),
			},
			{
				type: "item",
				label: `Delete ${ref.name} on remote…`,
				danger: true,
				onClick: () => onDeleteRef?.(ref, false),
			},
			{ type: "item", label: "Create Pull Request…", wip: true },
		]
	}

	return [
		{
			// Offered even for the branch already checked out: `git checkout <current>`
			// is a harmless no-op, and suppressing it would mean trusting a cached
			// `current` over git.
			type: "item",
			label: `Checkout ${ref.name}`,
			onClick: () => onCheckout?.(ref),
		},
		createBranchHere,
		copyName("Copy Branch Name to Clipboard"),
		{ type: "separator" },
		{ type: "item", label: `Merge ${ref.name} into current`, wip: true },
		{ type: "item", label: `Rebase current onto ${ref.name}`, wip: true },
		{ type: "separator" },
		{ type: "item", label: `Fetch ${ref.name}`, wip: true },
		{ type: "separator" },
		{ type: "item", label: `Push to origin/${ref.name}`, wip: true },
		{ type: "item", label: "Push to…", wip: true },
		{ type: "item", label: "Track Remote Branch…", wip: true },
		{ type: "separator" },
		diffAgainstCurrent,
		{ type: "separator" },
		{ type: "item", label: "Rename…", wip: true },
		{
			type: "item",
			label: `Delete ${ref.name}…`,
			danger: true,
			onClick: () => onDeleteRef?.(ref, false),
		},
		{
			// Separate item rather than a flag on the one above: `-D` throws away
			// unmerged commits, so it should never be one mis-click away from `-d`.
			type: "item",
			label: `Force delete ${ref.name}…`,
			danger: true,
			onClick: () => onDeleteRef?.(ref, true),
		},
		{ type: "separator" },
		{ type: "item", label: "Create Pull Request…", wip: true },
	]
}
