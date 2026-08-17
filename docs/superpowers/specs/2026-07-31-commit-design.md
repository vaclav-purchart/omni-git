# Commit (message box + Commit / Amend) — design

Date: 2026-07-31
Milestone: **M4 Write Loop**, first slice.

## Problem

Staging is done (`stage_file`/`unstage_file`/`stage_all`/`unstage_all`/`discard_file`)
but there is no way to turn a staged index into a commit. The local write loop
dead-ends: you can stage and unstage forever, then have to leave the app and
use the terminal. This slice closes it.

Out of scope (later M4 slices): fetch/pull/push with streamed output, hunk- and
line-level staging, discard-all, checkout.

## Approach

### Backend — `src-tauri/src/git/commit.rs`

Two new operations, exposed as commands in `commands/repo_write.rs`:

- `commit(repo_path, message, amend) -> String` — runs
  `git commit -m <message>` (plus `--amend` when amending), then
  `git rev-parse HEAD`, returning the new commit's SHA. Argv is built by a pure
  `commit_args(message, amend)` helper so it is unit-testable without an
  `AppHandle`, mirroring `working::working_diff_args`.
- `head_commit_message(repo_path) -> Option<String>` — `git log -1 --pretty=%B`,
  used to prefill the message box when the user ticks "Amend". Returns `None` on
  an unborn branch (no commits yet) rather than erroring.

Notes:

- **Hooks must run.** No `--no-verify`. A rejecting `pre-commit`/`commit-msg`
  hook exits non-zero, so `run` returns `GitError::NonZero` and the hook's own
  stderr is what the UI shows — which is exactly the desired behaviour, and is
  why the project uses the system git binary at all.
- The message is passed as a single argv element, so newlines, quotes and `$`
  need no escaping (no shell involved).
- "Nothing to commit" is git's own exit-1 error; its stderr is surfaced
  verbatim rather than being pre-empted by a bespoke check.
- `head_exists` (already in `stage.rs`, used for the unborn-branch fallbacks)
  becomes `pub(crate)` and is reused instead of duplicating the probe.

### Frontend — `src/detail/CommitBox.tsx`

A new component rendered by `WorkingCopyDetail` **below** the file list
(SourceTree-style): a message `<textarea>`, an "Amend last commit" checkbox, and
a Commit button.

- **Enablement.** Commit is disabled when the trimmed message is empty, or when
  nothing is staged and we are not amending (amend-only reword is legitimate
  with an empty index). Disabled while a commit is in flight.
- **Amend prefill.** Ticking Amend loads HEAD's message and puts it in the box,
  stashing whatever draft was there; unticking restores the draft. The checkbox
  is disabled on an unborn branch (`WorkingStatus.head === null`) — nothing to
  amend.
- **Ctrl/Cmd+Enter** commits from inside the textarea.
- **Errors** render in the existing dismissable inline-banner style, not as a
  full-panel error — a rejected commit must not blow away the staging UI.

### UI decisions (chosen by the user, 2026-07-31)

Asked where the commit UI should live; the answer was **docked under the file
list**, and — on the follow-up "popups, or as part of the file panel?" —
**inline, part of the panel**. This continues the precedent set by the file
filters ("second LINE, not a dropdown"). Concretely:

- The commit box is a section of the file panel, never a modal or popup.
- **Recent-message recall** is an inline line that expands *below* the actions
  row, not an anchored dropdown. Esc closes it. Backed by
  `recent_commit_messages` (`git log -n N --pretty=format:%B%x00` — NUL-
  delimited, because messages contain newlines). The list shows each message's
  subject; clicking inserts the *full* message, body included.
- **Popups stay reserved** for what already uses them: right-click context
  menus and destructive confirms.
- Streamed output from the future push slice belongs in the existing git
  console, not a progress dialog.

Space efficiency was an explicit concern, so the box is **collapsible**
(persisted under `commit-box-open`; the collapsed header still shows the
pending draft's first line so an unsent message is never invisible) and the
textarea **auto-grows** from ~3 lines to a `max-height` cap, after which it
scrolls rather than squeezing the file list out of the panel.

Keyboard-first was a stated priority: **Cmd/Ctrl+Enter** inside the box
commits; the same chord anywhere else in the working panel jumps to the box,
expanding it first if collapsed. Because a collapsed box has no textarea to
focus, `open` is owned by `WorkingCopyDetail` and the focus is deferred to an
effect that runs once the expanded box has rendered.

**Commit & Push was also requested but is deliberately NOT in this slice** — it
depends on the push backend (streaming, credential helpers, remote errors),
which is the next and largest remaining M4 piece. The combined button lands on
top of that.

### Draft survival (the non-obvious constraint)

`WorkingCopyDetail` is keyed on `refreshKey`, so it **remounts on every
refresh**, including watcher-driven ones the user did not trigger. A commit
message held in plain `useState` would be silently wiped mid-typing whenever
anything touched `.git`. The draft therefore lives in `usePersistentState`
under a per-repo key (`commit-draft:<repoPath>`), which both survives the
remount and — as a free side effect — survives app relaunch, matching what
desktop git clients do.

### After a successful commit

`onCommitted(sha)` bubbles to `Workspace`, which does `setSelectHash(sha)` and
`refresh()`. Both land in one React batch, so the railway remounts under its new
key already carrying the select-hash, and its existing load-until-found path
selects the brand-new commit. Without this the user is left staring at
"No uncommitted changes." — the working row disappears the moment the tree is
clean, leaving the selection pointing at a node that no longer exists.

The draft is cleared on success only.

## Known limitations (accepted)

- The working-copy view — and therefore the commit box — is only reachable when
  the working row is visible, i.e. when there is at least one staged, unstaged
  or untracked change. **Amend-only reword on a clean tree is unreachable.**
  Fixing it means showing the working row unconditionally, which is a separate
  railway-level decision.
- Amend rewrites history; there is no confirm gate on it, matching how other
  clients treat amend-before-push. Discard/remove keep their confirm gates.
- No commit-message templates, no `.gitmessage`, no sign-off, no GPG-signing UI
  (signing still happens if the user's git config demands it, since we shell out
  to the real binary).
