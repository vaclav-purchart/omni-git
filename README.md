<div align="center">
  <img src="public/icon.svg" alt="omni-git" width="96" height="96">
  <h1>omni-git</h1>
  <p><strong>A fast, keyboard-friendly desktop client for reading and driving your git repositories.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
    <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19">
    <img src="https://img.shields.io/badge/Rust-2021-CE422B?logo=rust&logoColor=white" alt="Rust">
    <img src="https://img.shields.io/badge/tests-744-brightgreen" alt="744 tests">
  </p>
</div>

---

<!-- TODO: replace with a real screenshot of the app (see "Screenshots" below). -->
<p align="center"><em>Screenshot coming soon.</em></p>

## What it is

omni-git shows a repository as a **commit railway** — straight, colour-distinguished lanes
instead of a tangled graph — with the working copy pinned at the top of the history where
you actually need it. Select a commit (or the working row) to get its files, select a file
to get its diff. Everything is one keystroke away, and anything the UI doesn't cover you
can type into the command palette.

It runs on your **system `git`**. There is no bundled git implementation and no reimplemented
plumbing: every action is a real `git` invocation, streamed back to you with its output, so
your hooks, config, credential helpers and signing all behave exactly as they do in a terminal.

## Features

**Repository overview**
- Searchable launcher for your added repositories — search is focused on launch, `Enter` opens
  the first match, `Esc` clears it. Removing a repo only forgets it; nothing on disk changes.
- Sidebar of local branches, remotes, tags, stashes and worktrees, with a live filter and
  a marker for branches whose upstream is gone.
- Commit railway with per-lane colours, ref badges, commit search, and a scope switch for
  *all refs* vs *current branch only*.

**Working copy**
- Stage and unstage by file, by selection, all, or tracked-only; discard changes; clean
  untracked files.
- Commit and amend from an inline commit box, with recent commit messages one keystroke away.
- Stash the working tree (including untracked files), inspect stash contents, restore.

**History and diffs**
- Per-commit file lists with filtering by name and by change class.
- Syntax-highlighted diffs with line numbers, whitespace-insensitive mode, a folded git
  preamble, binary-file handling, and "show as text" for a single file.
- Review mode: compare a branch against its base (fork point) and read only that branch's changes.

**Operations**
- Fetch, pull, push; merge as a merge commit (`--no-ff`), fast-forward, or squash.
- Create, check out and delete branches — local or remote — and check out a bare commit.
- Reset (soft / mixed / hard), cherry-pick, reword a commit.
- An operation banner when the repo is mid-merge / mid-cherry-pick, with continue and abort actions.

**Command palette and console**
- `⌘⇧P` opens the palette: type any git command. `Tab` completes subcommands and refs
  (refs match on their tail too, so `13723` finds `fix/P20009663-13723-…`), `↑`/`↓` walk history.
  Nothing is whitelisted — completion is a convenience, not a gate.
- A console strip along the bottom keeps the log of everything that ran, streams live output
  for long-running commands, and can hand off to your real terminal.

**Everywhere else**
- Keyboard shortcuts for navigation, selection and the common actions, with a searchable
  help overlay (opened from the console strip). Shortcuts are written in mac notation once
  and rewritten for Windows/Linux at render time.
- Light and dark theme, following the system or toggled manually.
- External changes are picked up by a debounced file watcher, so the app stays current without
  polling — the design goal is near-zero cost while idle.
- Window geometry, panel sizes and view preferences persist between launches.

## Keyboard shortcuts

A selection — the full, searchable list lives in the in-app help overlay. Shown in mac
notation; `⌘` reads as `Ctrl` on Windows and Linux.

| Keys | Action |
| --- | --- |
| `⌘⇧P` | Open the command palette |
| `⌘R` | Refresh the repository |
| `⌘⇧C` | Copy the open file's path |
| `↑` `↓` | Move through commits, files, or scroll the diff |
| `⇧↑` `⇧↓` | Extend the selection |
| `⌘Click` / `⇧Click` | Toggle one item / select a range |
| `Enter` | Descend: history → files → diff |
| `Backspace` | Back up one level |
| `⌘Enter` | Commit (or jump to the message box) |
| `Esc` | Close the palette, a menu, a dialog, or the output panel |

## Getting started

**Prerequisites**

- [Rust](https://rustup.rs) (stable) and [Node.js](https://nodejs.org) 20+
- `git` on your `PATH` — omni-git checks for it on startup
- Platform toolchain for [Tauri 2](https://tauri.app/start/prerequisites/):
  - **macOS** — Xcode Command Line Tools
  - **Windows** — MSVC build tools + WebView2
  - **Linux** — `webkit2gtk`, `libayatana-appindicator` and friends

**From a fresh clone**

```bash
git clone https://github.com/vaclav-purchart/omni-git.git
cd omni-git
npm ci                # or npm install

npm run tauri dev     # run it, with hot reload
npm run tauri build   # or: produce a release bundle
```

That is the whole sequence — there is no code-generation step to remember. `src/ipc/bindings.ts`,
the typed IPC surface the frontend imports, is generated rather than checked in, and the
`predev` / `prebuild` / `pretest` npm hooks create it before anything reads it. It costs one
extra Rust compile the first time (~50s on a warm cargo registry) which shares its cache with
the build that follows, so later runs are incremental.

Release bundles land in `src-tauri/target/release/bundle/`. Builds are per-platform: Tauri does
not support cross-compiling to macOS or Windows from another host, so produce each platform's
bundle on that platform (CI runners are the easy way).

## Development

```bash
npm run bindings # regenerate src/ipc/bindings.ts from the Rust command surface
npm test         # vitest — 62 files, 744 tests
npm run lint     # biome check
npm run format   # biome format --write
```

**Layout**

```
src/                  React frontend
  launcher/           repository picker
  workspace/          top-level shell, toolbar, dialogs, shortcuts
  railway/            commit graph: layout, rows, lanes, search
  sidebar/            branches, remotes, tags, stashes, worktrees
  detail/             commit / working-copy / stash detail + file lists
  diff/               diff rendering, highlighting, patch parsing
  palette/            command palette + completion
  console/            command log and live output streaming
  help/ theme/ ui/    help overlay, theming, shared widgets
  ipc/bindings.ts     generated — do not edit by hand

src-tauri/            Rust backend
  commands/           the Tauri command surface
  git/                one module per git area (log, stage, merge, …)
  store/              persisted repo list and settings
  watcher.rs          debounced filesystem watching
```

**Notes for contributors**

- The frontend never talks to git directly. It calls typed commands generated by
  [`tauri-specta`](https://github.com/oscartbeaumont/tauri-specta) into `src/ipc/bindings.ts`.
  That file is generated and **not** checked in, so a fresh clone doesn't have it: the `predev`,
  `prebuild` and `pretest` npm hooks run `npm run bindings` first, so every entry point that
  imports it generates it before it's needed. Regenerate by hand with `npm run bindings` after
  changing the Rust command surface; never edit it.
- Each git area gets its own module under `src-tauri/src/git/`, and git is invoked as a
  subprocess with an explicit environment — no libgit2.
- Tests are colocated with what they test (`Foo.tsx` next to `Foo.test.tsx`). Pure logic is
  pulled out into plain modules so it can be tested without rendering.
- `src/help/shortcutList.ts` is the single source of truth for shortcuts. Adding a shortcut
  means adding a line there too.
- The app icon is generated from one SVG — see [`design/icons/README.md`](design/icons/README.md).
  Edit the SVG, never the PNGs under `src-tauri/icons/`.

## Screenshots

The screenshot above still needs to be captured. `source-tree.png` in the repository root is
*not* omni-git — it's a reference shot of Sourcetree kept from the original design brief.

## Platform support

macOS, Windows and Linux are all targeted. Development happens on macOS; the other two
platforms need a build and a smoke test before they can be called verified.

## Status

Pre-1.0 and under active development. The read side (repository overview, history, diffs,
review mode) is settled; the write side (staging, commit, branch and history operations) is
in place and still being sanded down.
