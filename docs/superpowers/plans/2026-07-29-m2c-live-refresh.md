# Milestone 2c — Live Refresh & Console Buffer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-refresh the view when the repo changes on disk (new commits, checkouts, branch ops, fetch/merge/stash) via a debounced filesystem watch on `.git` — no polling, near-zero idle. Plus: the git console never misses its first entries, via a backend ring buffer the frontend seeds on mount.

**Architecture:** A Rust filesystem watcher (`notify` + `notify-debouncer-full`) on the repo's resolved git-dir emits a debounced, typed `RepoChanged` event; the watcher lives in Tauri managed state, started/replaced by a `watch_repo` command and stopped by `unwatch_repo`. Separately, the `git::run` wrapper pushes every `GitConsoleEntry` into a bounded ring buffer (managed state) in addition to emitting it live; a `recent_console_entries` command lets `useGitConsole` seed on mount so entries emitted before the listener attaches aren't lost. The frontend subscribes to `repoChanged` and reloads refs+commits (reusing the existing refresh key). Builds on merged M2b/M5.x.

**Tech Stack:** Existing + `notify` (v6) and `notify-debouncer-full` (Rust deps). No new frontend deps.

## Global Constraints

- **System git only** for git operations; the FS watcher is `notify`, a filesystem API (not a git library) — allowed (it watches files, doesn't interpret git).
- **No polling / near-zero idle:** the watcher is event-driven; idle = one cheap OS file-watch, zero git processes until an actual change (or user action).
- **Frontend uses only generated bindings** (commands + tauri-specta events); regenerate HEADLESSLY (`cargo test … export_bindings`); never `npm run tauri dev`; never commit `src/ipc/bindings.ts`.
- New commands/events register on the existing single `Builder` (`collect_commands!` / `collect_events!`); `builder.mount_events(app)` already in setup.
- TS7; Biome verbatim; theme-aware; frequent commits; author if unset `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.
- Preserve the existing `GitConsoleEntry` event + `useGitConsole` live subscription; the ring buffer AUGMENTS it (seed-then-live), and merging must DEDUPE by entry `id` (uuid) so a seeded entry and a live event for the same call don't double-add.

## File Structure

- `src-tauri/Cargo.toml` (modify) — add `notify`, `notify-debouncer-full`.
- `src-tauri/src/git/run.rs` (modify) — push each entry into the ring buffer.
- `src-tauri/src/console_log.rs` (new) — `ConsoleLog` bounded ring buffer (managed state).
- `src-tauri/src/watcher.rs` (new) — `RepoChanged` event, `RepoWatcher` managed state, `watch_repo`/`unwatch_repo`.
- `src-tauri/src/commands/repo_read.rs` (modify) — `recent_console_entries` command.
- `src-tauri/src/lib.rs` (modify) — `.manage(...)` the two states, register commands + the `RepoChanged` event.
- `src/console/useGitConsole.ts` (modify) — seed from `recentConsoleEntries` on mount; dedupe by id.
- `src/workspace/Workspace.tsx` (modify) — start/stop watcher on mount/unmount; refresh on `repoChanged`.
- `src/App.test.tsx` (modify) — mock the new commands/events.

---

### Task 1: Console ring buffer + `recent_console_entries`

**Files:**
- Create: `src-tauri/src/console_log.rs`
- Modify: `src-tauri/src/git/run.rs`, `src-tauri/src/commands/repo_read.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `pub struct ConsoleLog(pub std::sync::Mutex<std::collections::VecDeque<GitConsoleEntry>>)` with `pub fn push(&self, e: GitConsoleEntry)` (cap 500, pop-front when over) and `pub fn recent(&self) -> Vec<GitConsoleEntry>`.
  - `git::run::run` pushes the entry into `ConsoleLog` (via `app.try_state`) in addition to emitting the event.
  - Command `recent_console_entries() -> Vec<GitConsoleEntry>` (`recentConsoleEntries`).

- [ ] **Step 1: ConsoleLog with a unit test**

Create `src-tauri/src/console_log.rs`:
```rust
use crate::git::run::GitConsoleEntry;
use std::collections::VecDeque;
use std::sync::Mutex;

const CAP: usize = 500;

#[derive(Default)]
pub struct ConsoleLog(pub Mutex<VecDeque<GitConsoleEntry>>);

impl ConsoleLog {
	pub fn push(&self, entry: GitConsoleEntry) {
		let mut buf = self.0.lock().unwrap();
		buf.push_back(entry);
		while buf.len() > CAP {
			buf.pop_front();
		}
	}
	pub fn recent(&self) -> Vec<GitConsoleEntry> {
		self.0.lock().unwrap().iter().cloned().collect()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn entry(id: &str) -> GitConsoleEntry {
		GitConsoleEntry {
			id: id.to_string(),
			command: "git x".into(),
			exit_code: 0,
			duration_ms: 1,
			stderr: String::new(),
			timestamp_ms: 0,
		}
	}

	#[test]
	fn keeps_order_and_caps_at_500() {
		let log = ConsoleLog::default();
		for i in 0..(CAP + 10) {
			log.push(entry(&i.to_string()));
		}
		let recent = log.recent();
		assert_eq!(recent.len(), CAP);
		// oldest 10 dropped; first retained is id "10", last is id "509"
		assert_eq!(recent.first().unwrap().id, "10");
		assert_eq!(recent.last().unwrap().id, (CAP + 9).to_string());
	}
}
```
Add `mod console_log;` to `src-tauri/src/lib.rs`. (Ensure `GitConsoleEntry` fields are `pub` — they already are per the event struct.)

- [ ] **Step 2: Push from `run`**

In `src-tauri/src/git/run.rs`, in `run` (the one taking `&AppHandle`), after building `entry` and before/after emitting, push into the buffer if the state is managed:
```rust
use tauri::Manager;
// … inside run(), after `let (stdout, entry) = run_raw(...)?;`
if let Some(log) = app.try_state::<crate::console_log::ConsoleLog>() {
	log.push(entry.clone());
}
let _ = entry.emit(app);
```
(Keep the existing emit + Result mapping. `try_state` so `run_raw`-only unit tests without a managed state still work.)

- [ ] **Step 3: Command + manage state**

In `src-tauri/src/commands/repo_read.rs`:
```rust
#[tauri::command]
#[specta::specta]
pub fn recent_console_entries(
	app: tauri::AppHandle,
) -> Vec<crate::git::run::GitConsoleEntry> {
	use tauri::Manager;
	app.state::<crate::console_log::ConsoleLog>().recent()
}
```
In `src-tauri/src/lib.rs`: `.manage(console_log::ConsoleLog::default())` on the `tauri::Builder`, and add `commands::repo_read::recent_console_entries` to `collect_commands![...]`.

- [ ] **Step 4: Verify + regenerate**

Run: `cargo test --manifest-path src-tauri/Cargo.toml console_log && cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`
Expected: ring-buffer test passes; `commands.recentConsoleEntries(): Promise<GitConsoleEntry[]>` present.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: git-console ring buffer + recent_console_entries"
```

---

### Task 2: Seed `useGitConsole` on mount (dedupe by id)

**Files:**
- Modify: `src/console/useGitConsole.ts`

**Interfaces:**
- Unchanged signature `useGitConsole(max)`; now seeds from `commands.recentConsoleEntries()` on mount, then live events append, deduped by `id`.

- [ ] **Step 1: Seed + dedupe**

In `src/console/useGitConsole.ts`: on mount, call `commands.recentConsoleEntries()` and set the initial entries (capped to `max`); keep the existing `events.gitConsoleEntry.listen` subscription, but when appending a live entry, SKIP it if an entry with the same `id` already exists (dedupe). Concretely: the live handler does `setEntries((prev) => prev.some((e) => e.id === payload.id) ? prev : capped([...prev, payload]))`. Order the effects so the listener is attached and the seed fetched; if a live event arrives before the seed resolves, dedupe handles the overlap (seed won't re-add ids already appended). Import `commands`.

- [ ] **Step 2: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: PASS. (The existing GitConsole tests are presentational and unaffected; `useGitConsole` has no dedicated test — if you add one, mock `commands.recentConsoleEntries` + `events.gitConsoleEntry.listen`.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: seed git console from recent buffer (no missed first entries)"
```

---

### Task 3: FS watcher — `RepoChanged` event + `watch_repo`/`unwatch_repo`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)] pub struct RepoChanged {}` (empty payload).
  - `pub struct RepoWatcher(pub std::sync::Mutex<Option<Debouncer<...>>>)` managed state.
  - Commands `watch_repo(repo_path: String)` and `unwatch_repo()`.

- [ ] **Step 1: Add deps**

In `src-tauri/Cargo.toml` `[dependencies]`: `notify = "6"` and `notify-debouncer-full = "0.3"`.

- [ ] **Step 2: Implement the watcher**

Create `src-tauri/src/watcher.rs`:
```rust
use crate::git::run::run;
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, FileIdMap};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct RepoChanged {}

type Deb = Debouncer<notify::RecommendedWatcher, FileIdMap>;

#[derive(Default)]
pub struct RepoWatcher(pub Mutex<Option<Deb>>);

fn git_dir(app: &tauri::AppHandle, repo_path: &str) -> Option<PathBuf> {
	// Resolve the actual git dir (handles linked worktrees where .git is a file).
	run(app, repo_path, &["rev-parse", "--absolute-git-dir"])
		.ok()
		.map(|s| PathBuf::from(s.trim()))
		.filter(|p| p.exists())
}

pub fn watch(app: &tauri::AppHandle, repo_path: &str) {
	let Some(dir) = git_dir(app, repo_path) else {
		return;
	};
	let app_for_events = app.clone();
	let debouncer = new_debouncer(
		Duration::from_millis(400),
		None,
		move |res: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
			if let Ok(events) = res {
				if !events.is_empty() {
					let _ = RepoChanged {}.emit(&app_for_events);
				}
			}
		},
	);
	if let Ok(mut deb) = debouncer {
		if deb.watcher().watch(&dir, RecursiveMode::Recursive).is_ok() {
			let state = app.state::<RepoWatcher>();
			// Replace (and drop/stop) any previous watcher.
			*state.0.lock().unwrap() = Some(deb);
		}
	}
}

pub fn unwatch(app: &tauri::AppHandle) {
	if let Some(state) = app.try_state::<RepoWatcher>() {
		*state.0.lock().unwrap() = None; // drop → stops watching
	}
}
```
(Adapt the `new_debouncer` call / `Debouncer` type params to the installed `notify-debouncer-full` 0.3 API if it differs — the shape is: a 400ms timeout, no tick-rate, and a closure receiving `Result<Vec<DebouncedEvent>, _>`; store the returned debouncer so it isn't dropped. If the 0.3 API differs materially, match its docs but keep: resolve git-dir, watch recursively, emit `RepoChanged` on any batch of events, store in `RepoWatcher`.)

- [ ] **Step 3: Commands + registration**

Create the command wrappers (in `watcher.rs` or `commands/repo_read.rs`):
```rust
#[tauri::command]
#[specta::specta]
pub fn watch_repo(app: tauri::AppHandle, repo_path: String) {
	crate::watcher::watch(&app, &repo_path);
}

#[tauri::command]
#[specta::specta]
pub fn unwatch_repo(app: tauri::AppHandle) {
	crate::watcher::unwatch(&app);
}
```
In `src-tauri/src/lib.rs`: `mod watcher;`; `.manage(watcher::RepoWatcher::default())`; add `watch_repo`/`unwatch_repo` to `collect_commands![...]`; add `crate::watcher::RepoChanged` to `.events(collect_events![...])` (alongside the existing `GitConsoleEntry`).

- [ ] **Step 4: Build + regenerate**

Run: `cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`
Expected: builds (notify compiles); `commands.watchRepo(repoPath)`, `commands.unwatchRepo()`, and `events.repoChanged` present in bindings. (The watcher itself can't be exercised headlessly — verify by inspection; the debouncer is stored so it isn't immediately dropped.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: debounced .git filesystem watcher emitting repoChanged"
```

---

### Task 4: Frontend — watch on open, refresh on change

**Files:**
- Modify: `src/workspace/Workspace.tsx`, `src/App.test.tsx`

**Interfaces:**
- Consumes: `commands.watchRepo`/`unwatchRepo`, `events.repoChanged`.

- [ ] **Step 1: Start/stop watcher + refresh on event**

In `src/workspace/Workspace.tsx`, add an effect (keyed on `repo.path`):
```tsx
useEffect(() => {
	commands.watchRepo(repo.path)
	let cancelled = false
	let unlisten: (() => void) | undefined
	events.repoChanged
		.listen(() => setRefreshKey((k) => k + 1))
		.then((fn) => {
			if (cancelled) {
				fn()
			} else {
				unlisten = fn
			}
		})
	return () => {
		cancelled = true
		unlisten?.()
		commands.unwatchRepo()
	}
}, [repo.path])
```
This reuses the existing `refreshKey` (which already remounts the Sidebar + CommitRailway → refetch refs/commits). Import `events` from `../ipc/bindings` if not already. Keep the manual Refresh button as a fallback.

Note (accepted for this milestone): bumping `refreshKey` remounts the railway, so an external change resets the railway scroll/selection. External changes are infrequent (real git ops), so this is acceptable; a future refinement could reload data in place (e.g. `useRepoRefs.reload()` + a soft commits reload) to preserve scroll.

- [ ] **Step 2: App.test mock**

In `src/App.test.tsx`, extend the mock: add `watchRepo: vi.fn()`, `unwatchRepo: vi.fn()` to `commands`, and add `repoChanged: { listen: vi.fn().mockResolvedValue(() => {}) }` to the `events` mock (alongside `gitConsoleEntry`). Also add `recentConsoleEntries: vi.fn().mockResolvedValue([])` (used by `useGitConsole` on mount). Existing assertions unchanged.

- [ ] **Step 3: Verify**

Run: `npx vitest run && npm run build && cargo build --manifest-path src-tauri/Cargo.toml && npm run lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: workspace watches the repo and auto-refreshes on disk changes"
```

---

## Self-Review

**Spec coverage:**
- Live auto-refresh on disk change, no polling → Tasks 3 (debounced `.git` watch → `RepoChanged`) + 4 (subscribe → refresh) ✓
- Near-zero idle → event-driven watcher, no timers/polling ✓
- Console never misses first entries → Tasks 1 (ring buffer) + 2 (seed on mount, dedupe by id) ✓

**Placeholder scan:** none.

**Type consistency:** `GitConsoleEntry` reused by the buffer + `recent_console_entries`. `RepoChanged` event registered via `collect_events!` and consumed as `events.repoChanged`. New commands `recentConsoleEntries`/`watchRepo`/`unwatchRepo` mocked in App.test.

**Known risks:**
1. **Watcher can't be unit-tested headlessly** — `notify` needs real FS events. Verified by inspection + a manual GUI smoke test (commit/fetch in a terminal → view refreshes). The debouncer MUST be stored in `RepoWatcher` or it's dropped and stops immediately — Task 3 stores it.
2. **`.git` event noise** (e.g. `.git/objects` churn during fetch) → debounced 400ms into a single `RepoChanged`; acceptable. Watching `.git` (not the whole worktree) keeps it low-noise and avoids node_modules/target storms.
3. **Refresh via `refreshKey` remounts** the railway → resets scroll/selection on external change; accepted (infrequent), noted for a future in-place-reload refinement.
4. **`notify-debouncer-full` 0.3 API drift** — Task 3 flags adapting the `new_debouncer`/`Debouncer` generics to the installed version; the invariant (resolve git-dir, watch recursive, emit on batches, store the debouncer) is what matters.
5. **Seed/live race** — deduped by entry `id`, so seeding after a live event (or vice versa) can't double-add.
