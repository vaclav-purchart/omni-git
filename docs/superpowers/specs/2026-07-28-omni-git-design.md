# omni-git — Design Spec

**Status:** Approved (v1 scope)
**Date:** 2026-07-28

A cross-platform desktop git client that displays a repository in a clean, modern, graphical way — inspired by SourceTree (see `source-tree.png`). Optimized to run all day with near-zero idle resource use.

## Goals & Primary Driver

- **Primary goal:** ship the best possible daily-driver git client. Tech stack is a means to an end.
- Cross-platform: macOS, Windows, Linux.
- Intuitive, modern, clean UI. Useful information without overwhelming.
- Dark/light theme (from system, or manual override).
- Keyboard shortcuts for common actions, deliberately chosen to avoid accidental firing.
- Near-zero idle resource use — no busy polling.

## Tech Stack (decided)

- **Framework:** Tauri 2.
  - Rationale over Rust+GPUI: GPUI is young/thin (few widgets, less mature on Windows/Linux) and this is a UI-heavy app. Tauri lets us assemble mature libraries and ship a polished cross-platform result far faster. Trade-off accepted: WebView rendering isn't "truly native," but the difference is imperceptible for a git client.
- **Backend:** Rust, shelling out to the **system `git`** binary (never libgit2), so hooks, credential helpers, and config behave exactly as in the user's terminal.
- **Frontend:** React + **TypeScript 7**.
- **Typed IPC:** **tauri-specta** generates `src/ipc/bindings.ts` (Rust ↔ TS). Frontend only ever calls generated bindings — never touches git directly.
- **Lint/format:** Biome (config copied verbatim from `duplex-commander/biome.json`): Biome 2.5.4, tab indentation, double quotes, semicolons as-needed, trailing commas all, relaxed a11y rules. Ignores include `src/ipc/bindings.ts`, `src-tauri/target`, `src-tauri/gen`, `dist`, `docs`, `PROMPT.md`.
- **Diff editor:** CodeMirror 6.
- **List virtualization:** react-virtuoso.

## Architecture

Two-process Tauri app:

- **Rust core (backend):** owns all git interaction via the system `git` binary. Exposes typed commands via tauri-specta. Streams long-running command output (hooks, push/pull/fetch) to the frontend over Tauri **events**.
- **React frontend (webview):** pure view/interaction layer, calls generated bindings only.

### Git invocation model

- Every git action runs the real `git` binary and captures stdout/stderr line-by-line.
- Long-running commands (commit with hooks, push, pull, fetch) stream output live to the UI so hook progress and auth prompts are visible exactly as in a terminal.
- Every invocation returns a structured `Result` (exit code + stderr) surfaced as typed errors. git's stderr is shown verbatim so nothing is hidden.
- On launch, verify `git --version`; warn clearly if git is missing/misconfigured.

### Data & performance strategy (near-zero idle)

- **Incremental commit graph.** `git log --format=… -z` with pagination (e.g. first ~500 commits, load more on scroll). Graph topology (lanes/colors) computed in Rust — we do **not** parse git's ASCII graph.
- **No polling.** Watch the working tree + `.git` with the `notify` crate (filesystem watcher), debounced. Idle = zero git processes, just a cheap FS watch. Refresh fires only on real disk changes or explicit user action.
- **Repo list** persisted in a small local store (app config dir). Removing a repo edits only that store — never touches disk.
- **Caching.** Diffs and commit metadata cached per-commit (immutable); working-tree data invalidated on FS events.

## UI Layout

Mirrors SourceTree, refined:

- **Left sidebar:** collapsible sections — Local branches, Remote branches (grouped by remote), Tags, Worktrees, Stashes. Current branch highlighted. (In v1, Tags/Worktrees/Stashes are read-only listings; actions are fast-follows.)
- **Top toolbar:** Commit · Pull · Push · Fetch · Branch · Merge · Stash — icon + label + tooltip (tooltip shows the shortcut). v1 wires Commit/Pull/Push/Fetch; Branch/Merge/Stash are present but flagged coming-soon so the layout stays stable.
- **Center — commit railway:** filter bar (by branch, by author, search commit message) at top. **Uncommitted changes pinned as the first row.**
- **Detail area:** selecting a commit (or the working row) shows its file list; selecting a file shows the diff.
- **Bottom — git console (toggleable):** see below.

### Commit graph (the hard part)

- Rust computes lane assignment so branch lines stay **as straight and vertical as possible**.
- Each branch a distinct color from a fixed, colorblind-friendly palette (cycled), with shape/label cues so color is never the only signal.
- Rendered as crisp SVG/Canvas aligned row-for-row with the virtualized commit list, so large (50k+ commit) repos scroll smoothly.
- Single-branch view collapses to one clean vertical line.

### Diff view

- CodeMirror 6, syntax highlighted.
- Unified **and** side-by-side toggle, per-hunk context.
- Working-tree diffs support **line/hunk-level staging** (checkbox selection → stage → commit with message box).

### Git console panel (toggleable)

- Collapsible bottom panel logging **every** git invocation: exact command line, full stdout **and** stderr, exit code, duration, timestamp.
- Not just hooks — all git activity, so the user always sees exactly what the app did.
- Hook/push/pull/fetch streaming output flows into this same panel live.
- Toggle via toolbar button + keyboard shortcut. Off by default; rendering is lazy so it costs nothing when hidden. Entries are copy-able.

## Interaction & Keyboard

- **Repo launcher on start:** searchable list of added repos. Search field auto-focused. **Enter** opens first result. **Esc** clears search but keeps it focused.
- **Repo management:** add locally-checked-out repos; remove (store-only, no disk changes); search is the focused item on launch.
- **Shortcuts:** modifier-based, never bare letters, to avoid accidental firing. Initial set (macOS shown; platform-adapted): ⌘⏎ commit, ⌘⇧P push, ⌘⇧L pull, plus a toggle for the git console. Full map finalized in the plan.
- **Theme:** follows system, with manual override toggle.

## v1 Feature Checklist

1. Repo manager: add / remove / search / launch, with the launcher keyboard behavior above.
2. Left sidebar: branch (local/remote) / tag / worktree / stash listings.
3. Commit railway with filters (branch, author) + message search.
4. Commit detail → file list → diff view (unified + side-by-side).
5. Working changes with line/hunk-level staging → commit (with message box).
6. Pull / push / fetch with streamed output.
7. Live hook output.
8. Git console panel (toggleable).
9. Dark/light theming (system + manual).
10. FS-watch based refresh (no polling).

## Explicitly Deferred (fast-follows, not v1)

Branch create/checkout/delete, merge, stash operations, rebase (incl. interactive), conflict-resolution UI, tag operations, worktree operations, cherry-pick, blame. The toolbar/sidebar reserve space for these so the layout is stable when they land.

## Testing Approach

- **Rust core:** unit tests for git-output parsing and graph lane/color assignment against fixture repos; integration tests that run real `git` against temporary repos created in tests.
- **Frontend:** component tests for the commit railway, staging interactions, and diff rendering; logic tests for filter/search.
- **IPC:** typed bindings (tauri-specta) give compile-time contract checking between Rust and TS.
