# Milestone 2a — Commit History & Diff Viewer + Git Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn omni-git from a repo launcher into a read-only repository browser: select an added repo and see its commit history in a virtualized railway, click a commit to see its changed files, click a file to see its diff — with every git invocation logged to a toggleable git console.

**Architecture:** All git reads go through a single Rust `git::run` wrapper that shells out to system `git`, times the call, and emits a typed `GitConsoleEntry` event (tauri-specta events) that the frontend console panel subscribes to. Structured read commands (`log_commits`, `commit_files`, `file_diff`) are built on that wrapper and exposed as typed IPC. The frontend replaces `WorkspacePlaceholder` with a real `Workspace` (railway | detail/diff, console docked at the bottom). This is milestone 2a of the v1 plan; it produces a working read-only browser on its own.

**Tech Stack:** Existing (Tauri 2, Rust, React 18, TS7, tauri-specta 2, Biome, Vitest). New deps: `react-virtuoso` (commit list virtualization), `@uiw/react-codemirror` + `@codemirror/view` + `@codemirror/state` (diff viewer).

## Global Constraints

Apply to **every** task.

- **System git only** — all git interaction shells out to the system `git` binary via the `git::run` wrapper. Never libgit2, never a git library. Always invoke as `git -C <repo_path> <args>` so the process CWD is irrelevant.
- **Every git invocation is logged** — no command may bypass `git::run`; that wrapper is the sole place git is spawned for reads, and it is what feeds the console.
- **Frontend never touches git or the filesystem directly** — it calls only generated bindings from `src/ipc/bindings.ts` (commands and events).
- **`src/ipc/bindings.ts` is generated** by tauri-specta and git-ignored. Regenerate it **headlessly** with `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` — do NOT run `npm run tauri dev` (headless env, no display). Never hand-edit or commit it.
- **New commands register by ADDING to the existing `collect_commands![...]`** in `specta_builder()` (`src-tauri/src/lib.rs`); new events register via `collect_events![...]`. Do not create a second `Builder`.
- **TypeScript 7; Biome 2.5.4 verbatim** (tab indentation, double quotes, semicolons `asNeeded`, trailing commas `all`). Run `npm run format` then `npm run lint` before committing; the one pre-existing info-level biome config-deprecation notice is expected.
- **Theme tokens** — all new UI uses the CSS variables in `src/theme/theme.css` (`--bg`, `--surface`, `--surface-hover`, `--fg`, `--muted`, `--border`, `--accent`, `--accent-hover`, `--accent-fg`, `--danger-*`, `--ring`, `--shadow-*`). No hardcoded colors; both light and dark must look right.
- **Frequent commits** — each task ends by committing. Do NOT stage `src/ipc/bindings.ts`.
- **Commit author** if identity is unset: `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.

## File Structure

Backend (`src-tauri/src/`):
- `git/run.rs` (new) — the logging wrapper + `GitConsoleEntry` event + `GitError`.
- `git/log.rs` (new) — `log_commits` parsing.
- `git/changes.rs` (new) — `commit_files` + `file_diff`.
- `git/mod.rs` (modify) — declare new modules.
- `commands/repo_read.rs` (new) — thin `#[tauri::command]` wrappers.
- `commands/mod.rs`, `lib.rs` (modify) — register commands + events.

Frontend (`src/`):
- `workspace/Workspace.tsx` + `.css` (new) — the read layout; replaces the placeholder usage.
- `workspace/useCommits.ts` (new) — paginated commit-loading hook.
- `railway/CommitRailway.tsx` + `.css` (new) — virtualized list.
- `railway/CommitRow.tsx` (new) — one row (refs, subject, author, date, short hash).
- `detail/CommitDetail.tsx` + `.css` (new) — changed-files list.
- `diff/DiffView.tsx` + `.css` (new) — CodeMirror unified diff.
- `diff/diffHighlight.ts` + `.test.ts` (new) — pure diff-line classifier + CodeMirror decoration extension.
- `console/GitConsole.tsx` + `.css` (new) — dockable console.
- `console/useGitConsole.ts` (new) — event subscription + bounded buffer.
- `App.tsx` (modify) — render the new `Workspace`; delete `WorkspacePlaceholder`.
- `time.ts` + `.test.ts` (new) — relative-time formatting (pure).

---

### Task 1: Git run wrapper + typed console event

The single choke point for spawning `git` on reads: runs `git -C <repo> <args>`, measures duration, and emits a typed `GitConsoleEntry`. All later read commands build on this.

**Files:**
- Create: `src-tauri/src/git/run.rs`
- Modify: `src-tauri/src/git/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register the event via `collect_events!`)

**Interfaces:**
- Consumes: nothing from earlier M2 tasks.
- Produces:
  - `#[derive(Clone, Serialize, specta::Type, tauri_specta::Event)] pub struct GitConsoleEntry { pub id: String, pub command: String, pub exit_code: i32, pub duration_ms: u64, pub stderr: String, pub timestamp_ms: i64 }`
  - `#[derive(Debug, Clone, Serialize, specta::Type)] pub enum GitError { Spawn(String), NonZero { code: i32, stderr: String } }`
  - `pub fn run(app: &tauri::AppHandle, repo_path: &str, args: &[&str]) -> Result<String, GitError>` — spawns `git -C <repo_path> <args...>`, emits a `GitConsoleEntry` (always, success or failure), returns stdout on success or `GitError::NonZero`/`Spawn`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/git/run.rs`:
```rust
use serde::Serialize;
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct GitConsoleEntry {
	pub id: String,
	pub command: String,
	pub exit_code: i32,
	pub duration_ms: u64,
	pub stderr: String,
	pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind")]
pub enum GitError {
	Spawn(String),
	NonZero { code: i32, stderr: String },
}

fn now_ms() -> i64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0)
}

/// Runs `git -C <repo_path> <args...>`, capturing output and timing.
/// Returns (stdout, entry) regardless of exit status so callers can both
/// inspect the result and log it. Pure enough to unit-test without Tauri.
fn run_raw(repo_path: &str, args: &[&str]) -> Result<(String, GitConsoleEntry), GitError> {
	let started = Instant::now();
	let output = Command::new("git")
		.arg("-C")
		.arg(repo_path)
		.args(args)
		.output()
		.map_err(|e| GitError::Spawn(e.to_string()))?;
	let duration_ms = started.elapsed().as_millis() as u64;
	let stdout = String::from_utf8_lossy(&output.stdout).to_string();
	let stderr = String::from_utf8_lossy(&output.stderr).to_string();
	let exit_code = output.status.code().unwrap_or(-1);
	let entry = GitConsoleEntry {
		id: uuid::Uuid::new_v4().to_string(),
		command: format!("git -C {} {}", repo_path, args.join(" ")),
		exit_code,
		duration_ms,
		stderr: stderr.clone(),
		timestamp_ms: now_ms(),
	};
	Ok((stdout, entry))
}

pub fn run(
	app: &tauri::AppHandle,
	repo_path: &str,
	args: &[&str],
) -> Result<String, GitError> {
	let (stdout, entry) = run_raw(repo_path, args)?;
	let exit_code = entry.exit_code;
	let stderr = entry.stderr.clone();
	// Emit to the console regardless of success; ignore emit failures.
	let _ = entry.emit(app);
	if exit_code == 0 {
		Ok(stdout)
	} else {
		Err(GitError::NonZero { code: exit_code, stderr })
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command as StdCommand;

	fn temp_repo_with_one_commit() -> tempfile::TempDir {
		let dir = tempfile::tempdir().unwrap();
		let p = dir.path();
		for args in [
			vec!["init"],
			vec!["config", "user.email", "t@e.st"],
			vec!["config", "user.name", "Test"],
		] {
			StdCommand::new("git").arg("-C").arg(p).args(&args).output().unwrap();
		}
		std::fs::write(p.join("a.txt"), "hello\n").unwrap();
		StdCommand::new("git").arg("-C").arg(p).args(["add", "."]).output().unwrap();
		StdCommand::new("git")
			.arg("-C")
			.arg(p)
			.args(["commit", "-m", "first"])
			.output()
			.unwrap();
		dir
	}

	#[test]
	fn run_raw_captures_stdout_and_entry_on_success() {
		let repo = temp_repo_with_one_commit();
		let (stdout, entry) =
			run_raw(repo.path().to_str().unwrap(), &["rev-parse", "HEAD"]).unwrap();
		assert_eq!(stdout.trim().len(), 40, "HEAD should be a 40-char sha");
		assert_eq!(entry.exit_code, 0);
		assert!(entry.command.contains("rev-parse HEAD"));
	}

	#[test]
	fn run_raw_reports_nonzero_via_entry() {
		let repo = temp_repo_with_one_commit();
		let (_stdout, entry) =
			run_raw(repo.path().to_str().unwrap(), &["cat-file", "-e", "deadbeef"]).unwrap();
		assert_ne!(entry.exit_code, 0, "unknown object should exit non-zero");
	}
}
```
Add to `src-tauri/src/git/mod.rs`: `pub mod run;`

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::run`
Expected: 2 tests PASS (git is installed). If they fail, fix the implementation.

- [ ] **Step 3: Register the event**

In `src-tauri/src/lib.rs`, add the event collection to the builder. The builder currently is:
```rust
let builder = Builder::<tauri::Wry>::new().commands(collect_commands![ ... ]);
```
Change it to also register events:
```rust
use tauri_specta::collect_events;
let builder = Builder::<tauri::Wry>::new()
	.commands(collect_commands![ /* existing commands, unchanged */ ])
	.events(collect_events![crate::git::run::GitConsoleEntry]);
```
Keep `builder.mount_events(app)` in `setup` (already present). No other change.

- [ ] **Step 4: Regenerate bindings headlessly and confirm the event type exists**

Run: `cargo test --manifest-path src-tauri/Cargo.toml export_bindings`
Then: `npm run build`
Expected: build passes; `src/ipc/bindings.ts` now exports an `events` object including `gitConsoleEntry` and a `GitConsoleEntry` type. (If the generated event accessor name differs in your tauri-specta version, note the actual name — later tasks reference it.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: git run wrapper with typed console event"
```

---

### Task 2: `log_commits` — paginated structured history

Parse `git log` into structured commit summaries with pagination.

**Files:**
- Create: `src-tauri/src/git/log.rs`
- Modify: `src-tauri/src/git/mod.rs`

**Interfaces:**
- Consumes: `git::run::{run, GitError}` (Task 1).
- Produces:
  - `#[derive(Clone, Serialize, specta::Type)] pub struct CommitSummary { pub hash: String, pub parents: Vec<String>, pub author_name: String, pub author_email: String, pub timestamp_ms: i64, pub refs: Vec<String>, pub subject: String }`
  - `pub fn log_commits(app: &tauri::AppHandle, repo_path: &str, skip: u32, limit: u32) -> Result<Vec<CommitSummary>, GitError>`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/git/log.rs`:
```rust
use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CommitSummary {
	pub hash: String,
	pub parents: Vec<String>,
	pub author_name: String,
	pub author_email: String,
	pub timestamp_ms: i64,
	pub refs: Vec<String>,
	pub subject: String,
}

// Field sep = US (0x1f), record sep = RS (0x1e). Order must match parse_line.
const FORMAT: &str = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e";

fn parse_line(record: &str) -> Option<CommitSummary> {
	let f: Vec<&str> = record.split('\u{1f}').collect();
	if f.len() < 7 {
		return None;
	}
	let parents = if f[1].trim().is_empty() {
		Vec::new()
	} else {
		f[1].split_whitespace().map(|s| s.to_string()).collect()
	};
	let refs = if f[5].trim().is_empty() {
		Vec::new()
	} else {
		f[5].split(", ").map(|s| s.trim().to_string()).collect()
	};
	let timestamp_ms = f[4].trim().parse::<i64>().unwrap_or(0) * 1000;
	Some(CommitSummary {
		hash: f[0].to_string(),
		parents,
		author_name: f[2].to_string(),
		author_email: f[3].to_string(),
		timestamp_ms,
		refs,
		subject: f[6].to_string(),
	})
}

pub fn parse_log(stdout: &str) -> Vec<CommitSummary> {
	stdout
		.split('\u{1e}')
		.map(|r| r.trim_matches('\n'))
		.filter(|r| !r.is_empty())
		.filter_map(parse_line)
		.collect()
}

pub fn log_commits(
	app: &tauri::AppHandle,
	repo_path: &str,
	skip: u32,
	limit: u32,
) -> Result<Vec<CommitSummary>, GitError> {
	let format_arg = format!("--pretty=format:{}", FORMAT);
	let skip_arg = format!("--skip={}", skip);
	let max_arg = format!("--max-count={}", limit);
	let stdout = run(
		app,
		repo_path,
		&["log", "--decorate=short", &format_arg, &skip_arg, &max_arg],
	)?;
	Ok(parse_log(&stdout))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_a_record_with_refs_and_parents() {
		let rec = "abc123\u{1f}p1 p2\u{1f}Ada\u{1f}ada@x.io\u{1f}1700000000\u{1f}HEAD -> main, origin/main\u{1f}Add thing\u{1e}";
		let out = parse_log(rec);
		assert_eq!(out.len(), 1);
		let c = &out[0];
		assert_eq!(c.hash, "abc123");
		assert_eq!(c.parents, vec!["p1", "p2"]);
		assert_eq!(c.author_name, "Ada");
		assert_eq!(c.timestamp_ms, 1_700_000_000_000);
		assert_eq!(c.refs, vec!["HEAD -> main", "origin/main"]);
		assert_eq!(c.subject, "Add thing");
	}

	#[test]
	fn root_commit_has_no_parents_and_empty_refs() {
		let rec = "root1\u{1f}\u{1f}Bob\u{1f}b@x.io\u{1f}1699999999\u{1f}\u{1f}init\u{1e}";
		let c = &parse_log(rec)[0];
		assert!(c.parents.is_empty());
		assert!(c.refs.is_empty());
		assert_eq!(c.subject, "init");
	}

	#[test]
	fn empty_output_yields_no_commits() {
		assert!(parse_log("").is_empty());
	}
}
```
Add to `src-tauri/src/git/mod.rs`: `pub mod log;`

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::log`
Expected: 3 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: paginated structured git log parsing"
```

---

### Task 3: `commit_files` + `file_diff`

Changed-files for a commit, and the unified diff text for one file in a commit.

**Files:**
- Create: `src-tauri/src/git/changes.rs`
- Modify: `src-tauri/src/git/mod.rs`

**Interfaces:**
- Consumes: `git::run::{run, GitError}` (Task 1).
- Produces:
  - `#[derive(Clone, Serialize, specta::Type)] pub struct FileChange { pub status: String, pub path: String }` (status is one of `"A"|"M"|"D"|"R"|"C"|"T"|...`; for renames, `path` is the new path).
  - `pub fn commit_files(app: &tauri::AppHandle, repo_path: &str, hash: &str) -> Result<Vec<FileChange>, GitError>`
  - `pub fn file_diff(app: &tauri::AppHandle, repo_path: &str, hash: &str, path: &str) -> Result<String, GitError>`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/git/changes.rs`:
```rust
use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct FileChange {
	pub status: String,
	pub path: String,
}

/// Parses `git diff-tree --name-status -r -z` output: NUL-separated tokens
/// alternating status, path (rename/copy statuses emit status, old, new).
pub fn parse_name_status(z: &str) -> Vec<FileChange> {
	let mut out = Vec::new();
	let mut it = z.split('\u{0}').filter(|s| !s.is_empty());
	while let Some(status) = it.next() {
		let code = status.chars().next().unwrap_or('?');
		if code == 'R' || code == 'C' {
			// old path then new path; keep the new path.
			let _old = it.next();
			if let Some(new_path) = it.next() {
				out.push(FileChange {
					status: code.to_string(),
					path: new_path.to_string(),
				});
			}
		} else if let Some(path) = it.next() {
			out.push(FileChange {
				status: code.to_string(),
				path: path.to_string(),
			});
		}
	}
	out
}

pub fn commit_files(
	app: &tauri::AppHandle,
	repo_path: &str,
	hash: &str,
) -> Result<Vec<FileChange>, GitError> {
	// --root makes the initial commit list its files instead of nothing.
	let z = run(
		app,
		repo_path,
		&["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--root", hash],
	)?;
	Ok(parse_name_status(&z))
}

pub fn file_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	hash: &str,
	path: &str,
) -> Result<String, GitError> {
	// `show --format=` suppresses the commit header, leaving just the patch
	// for this path. `--` disambiguates the pathspec.
	run(
		app,
		repo_path,
		&["show", "--format=", "--patch", hash, "--", path],
	)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_add_modify_delete() {
		let z = "A\u{0}new.txt\u{0}M\u{0}changed.rs\u{0}D\u{0}gone.md\u{0}";
		let out = parse_name_status(z);
		assert_eq!(out.len(), 3);
		assert_eq!(out[0].status, "A");
		assert_eq!(out[0].path, "new.txt");
		assert_eq!(out[2].status, "D");
		assert_eq!(out[2].path, "gone.md");
	}

	#[test]
	fn rename_keeps_new_path() {
		let z = "R100\u{0}old/name.rs\u{0}new/name.rs\u{0}";
		let out = parse_name_status(z);
		assert_eq!(out.len(), 1);
		assert_eq!(out[0].status, "R");
		assert_eq!(out[0].path, "new/name.rs");
	}
}
```
Add to `src-tauri/src/git/mod.rs`: `pub mod changes;`

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::changes`
Expected: 2 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: commit changed-files and per-file diff"
```

---

### Task 4: Expose read commands via typed IPC

Thin command wrappers so the frontend can call the Task 2/3 functions.

**Files:**
- Create: `src-tauri/src/commands/repo_read.rs`
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `git::log::{log_commits, CommitSummary}`, `git::changes::{commit_files, file_diff, FileChange}`, `git::run::GitError`.
- Produces commands (generated TS names in parens):
  - `log_commits(repo_path: String, skip: u32, limit: u32) -> Result<Vec<CommitSummary>, GitError>` (`logCommits`)
  - `commit_files(repo_path: String, hash: String) -> Result<Vec<FileChange>, GitError>` (`commitFiles`)
  - `file_diff(repo_path: String, hash: String, path: String) -> Result<String, GitError>` (`fileDiff`)

- [ ] **Step 1: Create the command wrappers**

Create `src-tauri/src/commands/repo_read.rs`:
```rust
use crate::git::changes::{commit_files as gc, file_diff as gd, FileChange};
use crate::git::log::{log_commits as gl, CommitSummary};
use crate::git::run::GitError;

#[tauri::command]
#[specta::specta]
pub fn log_commits(
	app: tauri::AppHandle,
	repo_path: String,
	skip: u32,
	limit: u32,
) -> Result<Vec<CommitSummary>, GitError> {
	gl(&app, &repo_path, skip, limit)
}

#[tauri::command]
#[specta::specta]
pub fn commit_files(
	app: tauri::AppHandle,
	repo_path: String,
	hash: String,
) -> Result<Vec<FileChange>, GitError> {
	gc(&app, &repo_path, &hash)
}

#[tauri::command]
#[specta::specta]
pub fn file_diff(
	app: tauri::AppHandle,
	repo_path: String,
	hash: String,
	path: String,
) -> Result<String, GitError> {
	gd(&app, &repo_path, &hash, &path)
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/commands/mod.rs` add `pub mod repo_read;`. In `src-tauri/src/lib.rs`, add to the existing `collect_commands![...]`: `commands::repo_read::log_commits, commands::repo_read::commit_files, commands::repo_read::file_diff`.

- [ ] **Step 3: Regenerate bindings and typecheck**

Run: `cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`
Expected: `commands.logCommits`, `commands.commitFiles`, `commands.fileDiff` present and typed; `CommitSummary`, `FileChange`, `GitError` exported.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: repo-read IPC commands (log, files, diff)"
```

---

### Task 5: Relative-time helper (pure, TDD)

A small pure function used by commit rows and the console. TDD.

**Files:**
- Create: `src/time.ts`, `src/time.test.ts`

**Interfaces:**
- Produces: `formatRelative(timestampMs: number, nowMs: number): string` — "just now" (<60s), "Nm ago" (<60m), "Nh ago" (<24h), "Nd ago" (<7d), else a `YYYY-MM-DD` date. `nowMs` is injected (no `Date.now()` inside) so it's deterministic.

- [ ] **Step 1: Write the failing test**

Create `src/time.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/time.test.ts`
Expected: FAIL — cannot find `./time`.

- [ ] **Step 3: Implement**

Create `src/time.ts`:
```ts
export function formatRelative(timestampMs: number, nowMs: number): string {
	const diff = nowMs - timestampMs
	const sec = Math.floor(diff / 1000)
	if (sec < 60) {
		return "just now"
	}
	const min = Math.floor(sec / 60)
	if (min < 60) {
		return `${min}m ago`
	}
	const hr = Math.floor(min / 60)
	if (hr < 24) {
		return `${hr}h ago`
	}
	const day = Math.floor(hr / 24)
	if (day < 7) {
		return `${day}d ago`
	}
	const d = new Date(timestampMs)
	const y = d.getUTCFullYear()
	const m = String(d.getUTCMonth() + 1).padStart(2, "0")
	const dd = String(d.getUTCDate()).padStart(2, "0")
	return `${y}-${m}-${dd}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/time.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: relative-time formatting helper"
```

---

### Task 6: Diff-line classifier + CodeMirror decoration

A pure classifier (TDD) plus the CodeMirror extension that colors unified-diff lines.

**Files:**
- Create: `src/diff/diffHighlight.ts`, `src/diff/diffHighlight.test.ts`
- Modify: `package.json` (add `@uiw/react-codemirror`, `@codemirror/view`, `@codemirror/state`)

**Interfaces:**
- Produces:
  - `classifyDiffLine(line: string): "add" | "del" | "hunk" | "meta" | "context"` — `+++`/`---`/`diff `/`index `/`@@` handling: lines starting with `@@` → "hunk"; `+++ `/`--- ` → "meta"; `diff `/`index `/`new file`/`deleted file`/`rename ` → "meta"; a leading `+` (not `+++`) → "add"; a leading `-` (not `---`) → "del"; else "context".
  - `diffHighlighter: Extension` — a CodeMirror `ViewPlugin` adding a line class (`cm-diff-add`/`cm-diff-del`/`cm-diff-hunk`/`cm-diff-meta`) per `classifyDiffLine`.

- [ ] **Step 1: Add deps**

In `package.json` dependencies add `@uiw/react-codemirror`, `@codemirror/view`, `@codemirror/state`. Run `npm install`.

- [ ] **Step 2: Write the failing test (classifier only — the extension needs a DOM editor, covered by the DiffView smoke test in Task 7)**

Create `src/diff/diffHighlight.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { classifyDiffLine } from "./diffHighlight"

describe("classifyDiffLine", () => {
	it("classifies hunk headers", () => {
		expect(classifyDiffLine("@@ -1,3 +1,4 @@")).toBe("hunk")
	})
	it("classifies added and removed lines", () => {
		expect(classifyDiffLine("+added")).toBe("add")
		expect(classifyDiffLine("-removed")).toBe("del")
	})
	it("treats file markers as meta, not add/del", () => {
		expect(classifyDiffLine("+++ b/file.ts")).toBe("meta")
		expect(classifyDiffLine("--- a/file.ts")).toBe("meta")
		expect(classifyDiffLine("diff --git a/x b/x")).toBe("meta")
		expect(classifyDiffLine("index e69de29..0cfbf08")).toBe("meta")
	})
	it("classifies context lines", () => {
		expect(classifyDiffLine(" unchanged")).toBe("context")
		expect(classifyDiffLine("")).toBe("context")
	})
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/diff/diffHighlight.test.ts`
Expected: FAIL — cannot find `./diffHighlight`.

- [ ] **Step 4: Implement**

Create `src/diff/diffHighlight.ts`:
```ts
import { RangeSetBuilder } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view"

export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context"

export function classifyDiffLine(line: string): DiffLineKind {
	if (line.startsWith("@@")) {
		return "hunk"
	}
	if (
		line.startsWith("+++") ||
		line.startsWith("---") ||
		line.startsWith("diff ") ||
		line.startsWith("index ") ||
		line.startsWith("new file") ||
		line.startsWith("deleted file") ||
		line.startsWith("rename ")
	) {
		return "meta"
	}
	if (line.startsWith("+")) {
		return "add"
	}
	if (line.startsWith("-")) {
		return "del"
	}
	return "context"
}

const lineDeco: Record<Exclude<DiffLineKind, "context">, Decoration> = {
	add: Decoration.line({ class: "cm-diff-add" }),
	del: Decoration.line({ class: "cm-diff-del" }),
	hunk: Decoration.line({ class: "cm-diff-hunk" }),
	meta: Decoration.line({ class: "cm-diff-meta" }),
}

function build(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>()
	for (const { from, to } of view.visibleRanges) {
		let pos = from
		while (pos <= to) {
			const line = view.state.doc.lineAt(pos)
			const kind = classifyDiffLine(line.text)
			if (kind !== "context") {
				builder.add(line.from, line.from, lineDeco[kind])
			}
			pos = line.to + 1
		}
	}
	return builder.finish()
}

export const diffHighlighter: Extension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet
		constructor(view: EditorView) {
			this.decorations = build(view)
		}
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged) {
				this.decorations = build(u.view)
			}
		}
	},
	{ decorations: (v) => v.decorations },
)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/diff/diffHighlight.test.ts`
Expected: PASS (4).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: unified-diff line classifier and CodeMirror decoration"
```

---

### Task 7: DiffView component

Renders a unified diff string in a read-only CodeMirror editor with the Task 6 decoration and theme-aware colors.

**Files:**
- Create: `src/diff/DiffView.tsx`, `src/diff/DiffView.css`, `src/diff/DiffView.test.tsx`

**Interfaces:**
- Consumes: `diffHighlighter` (Task 6).
- Produces: `<DiffView diff={string} />` — a read-only editor; shows an empty-state ("No changes to display") when `diff` is empty/whitespace.

- [ ] **Step 1: Write the failing test**

Create `src/diff/DiffView.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DiffView } from "./DiffView"

describe("DiffView", () => {
	it("renders diff text content", async () => {
		const diff = "@@ -1 +1 @@\n-old line\n+new line\n"
		render(<DiffView diff={diff} />)
		expect(await screen.findByText(/new line/)).toBeInTheDocument()
	})

	it("shows an empty state when there is no diff", () => {
		render(<DiffView diff="" />)
		expect(screen.getByText(/no changes to display/i)).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/diff/DiffView.test.tsx`
Expected: FAIL — cannot find `./DiffView`.

- [ ] **Step 3: Implement**

Create `src/diff/DiffView.tsx`:
```tsx
import { EditorView } from "@codemirror/view"
import CodeMirror from "@uiw/react-codemirror"
import { diffHighlighter } from "./diffHighlight"
import "./DiffView.css"

const readOnlyTheme = EditorView.theme({
	"&": { backgroundColor: "transparent", fontSize: "12.5px" },
	".cm-content": { fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" },
	".cm-gutters": { display: "none" },
})

export function DiffView({ diff }: { diff: string }) {
	if (diff.trim() === "") {
		return <div className="diff-empty">No changes to display</div>
	}
	return (
		<div className="diff-view">
			<CodeMirror
				value={diff}
				editable={false}
				basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
				extensions={[EditorView.lineWrapping, diffHighlighter, readOnlyTheme]}
			/>
		</div>
	)
}
```
Create `src/diff/DiffView.css`:
```css
.diff-view {
	height: 100%;
	overflow: auto;
	background: var(--surface);
}
.diff-empty {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
	color: var(--muted);
}
.cm-diff-add {
	background: rgba(46, 160, 67, 0.15);
}
.cm-diff-del {
	background: rgba(248, 81, 73, 0.15);
}
.cm-diff-hunk {
	background: var(--surface-hover);
	color: var(--muted);
}
.cm-diff-meta {
	color: var(--muted);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/diff/DiffView.test.tsx`
Expected: PASS (2). (If jsdom lacks a layout API CodeMirror needs, the existing `src/test-setup.ts` already polyfills `matchMedia`; add a minimal `Range.getClientRects`/`getBoundingClientRect` polyfill there ONLY if a test error demands it, and note it.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: DiffView (read-only CodeMirror unified diff)"
```

---

### Task 8: Git console (event subscription + panel)

A bounded buffer hook subscribing to `GitConsoleEntry` events, and a dockable, toggleable console panel.

**Files:**
- Create: `src/console/useGitConsole.ts`, `src/console/GitConsole.tsx`, `src/console/GitConsole.css`
- Create: `src/console/GitConsole.test.tsx`

**Interfaces:**
- Consumes: `events.gitConsoleEntry` from `src/ipc/bindings.ts` (Task 1) and the `GitConsoleEntry` type.
- Produces:
  - `useGitConsole(max: number)` → `{ entries: GitConsoleEntry[], clear() }` — subscribes on mount, unsubscribes on unmount, keeps at most `max` most-recent entries.
  - `<GitConsole entries={GitConsoleEntry[]} open={boolean} onToggle={() => void} onClear={() => void} />` — a header bar (title, entry count, clear, collapse toggle) and, when `open`, a scrollable log; each row shows the command, exit code (styled red when non-zero), duration, and stderr when present.

- [ ] **Step 1: Write the failing test**

Create `src/console/GitConsole.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { GitConsole } from "./GitConsole"

const entries = [
	{
		id: "1",
		command: "git -C /r log --max-count=50",
		exitCode: 0,
		durationMs: 12,
		stderr: "",
		timestampMs: 1_700_000_000_000,
	},
	{
		id: "2",
		command: "git -C /r cat-file -e deadbeef",
		exitCode: 128,
		durationMs: 4,
		stderr: "fatal: Not a valid object name",
		timestampMs: 1_700_000_001_000,
	},
]

describe("GitConsole", () => {
	it("lists commands with their exit status when open", () => {
		render(
			<GitConsole entries={entries} open={true} onToggle={vi.fn()} onClear={vi.fn()} />,
		)
		expect(screen.getByText(/log --max-count=50/)).toBeInTheDocument()
		expect(screen.getByText(/not a valid object name/i)).toBeInTheDocument()
	})

	it("hides the log body when collapsed but keeps the header", () => {
		render(
			<GitConsole entries={entries} open={false} onToggle={vi.fn()} onClear={vi.fn()} />,
		)
		expect(screen.queryByText(/log --max-count=50/)).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: /git console/i })).toBeInTheDocument()
	})

	it("calls onToggle when the header is clicked", async () => {
		const onToggle = vi.fn()
		render(
			<GitConsole entries={entries} open={false} onToggle={onToggle} onClear={vi.fn()} />,
		)
		await userEvent.click(screen.getByRole("button", { name: /git console/i }))
		expect(onToggle).toHaveBeenCalledOnce()
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/console/GitConsole.test.tsx`
Expected: FAIL — cannot find `./GitConsole`.

- [ ] **Step 3: Implement the hook**

Create `src/console/useGitConsole.ts`:
```ts
import { useEffect, useState } from "react"
import { events, type GitConsoleEntry } from "../ipc/bindings"

export function useGitConsole(max: number) {
	const [entries, setEntries] = useState<GitConsoleEntry[]>([])

	useEffect(() => {
		let unlisten: (() => void) | undefined
		let cancelled = false
		events.gitConsoleEntry
			.listen((e) => {
				setEntries((prev) => {
					const next = [...prev, e.payload]
					return next.length > max ? next.slice(next.length - max) : next
				})
			})
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
		}
	}, [max])

	return { entries, clear: () => setEntries([]) }
}
```
(Adapt `events.gitConsoleEntry.listen` to the exact accessor tauri-specta generated in Task 1 if the name differs.)

- [ ] **Step 4: Implement the panel**

Create `src/console/GitConsole.tsx`:
```tsx
import type { GitConsoleEntry } from "../ipc/bindings"
import "./GitConsole.css"

export function GitConsole({
	entries,
	open,
	onToggle,
	onClear,
}: {
	entries: GitConsoleEntry[]
	open: boolean
	onToggle: () => void
	onClear: () => void
}) {
	return (
		<div className={`git-console ${open ? "is-open" : ""}`}>
			<div className="git-console-header">
				<button type="button" className="git-console-title" onClick={onToggle}>
					<span className="git-console-caret">{open ? "▾" : "▸"}</span>
					Git console
					<span className="git-console-count">{entries.length}</span>
				</button>
				<button
					type="button"
					className="git-console-clear"
					onClick={onClear}
					disabled={entries.length === 0}
				>
					Clear
				</button>
			</div>
			{open && (
				<div className="git-console-body">
					{entries.map((e) => (
						<div key={e.id} className="git-console-entry">
							<code className="git-console-cmd">{e.command}</code>
							<span
								className={`git-console-exit ${e.exitCode === 0 ? "ok" : "err"}`}
							>
								exit {e.exitCode} · {e.durationMs}ms
							</span>
							{e.stderr.trim() !== "" && (
								<pre className="git-console-stderr">{e.stderr}</pre>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	)
}
```
Create `src/console/GitConsole.css`:
```css
.git-console {
	border-top: 1px solid var(--border);
	background: var(--surface);
	display: flex;
	flex-direction: column;
	min-height: 0;
}
.git-console.is-open {
	height: 30vh;
}
.git-console-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 4px 10px;
	flex: none;
}
.git-console-title {
	display: flex;
	align-items: center;
	gap: 8px;
	background: none;
	border: none;
	color: var(--fg);
	font-weight: 500;
}
.git-console-caret {
	color: var(--muted);
	width: 12px;
}
.git-console-count {
	color: var(--muted);
	font-size: 12px;
}
.git-console-clear {
	background: none;
	border: 1px solid var(--border);
	border-radius: 6px;
	color: var(--fg);
	padding: 2px 10px;
}
.git-console-clear:disabled {
	opacity: 0.4;
	cursor: default;
}
.git-console-body {
	overflow-y: auto;
	padding: 4px 10px 10px;
	font-family: ui-monospace, "SF Mono", Menlo, monospace;
	font-size: 12px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.git-console-entry {
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.git-console-cmd {
	color: var(--fg);
}
.git-console-exit.ok {
	color: var(--muted);
}
.git-console-exit.err {
	color: var(--danger-fg);
}
.git-console-stderr {
	margin: 2px 0 0;
	white-space: pre-wrap;
	color: var(--danger-fg);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/console/GitConsole.test.tsx`
Expected: PASS (3).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: git console panel and event-subscription hook"
```

---

### Task 9: Commit railway (virtualized) + commit-loading hook

The center panel: a virtualized, paginated list of commits with ref labels; selecting a commit raises `onSelect`.

**Files:**
- Create: `src/workspace/useCommits.ts`
- Create: `src/railway/CommitRailway.tsx`, `src/railway/CommitRow.tsx`, `src/railway/CommitRailway.css`
- Create: `src/railway/CommitRow.test.tsx`
- Modify: `package.json` (add `react-virtuoso`)

**Interfaces:**
- Consumes: `commands.logCommits` + `CommitSummary` type; `formatRelative` (Task 5).
- Produces:
  - `useCommits(repoPath: string, pageSize: number)` → `{ commits: CommitSummary[], loadMore(), loading: boolean, reachedEnd: boolean, error: string | null }` — loads the first page on mount, appends on `loadMore()`, sets `reachedEnd` when a page returns fewer than `pageSize`.
  - `<CommitRow commit={CommitSummary} nowMs={number} selected={boolean} onClick={() => void} />`
  - `<CommitRailway repoPath={string} selectedHash={string | null} onSelect={(c: CommitSummary) => void} />` — owns `useCommits`, renders a `react-virtuoso` `Virtuoso` with `endReached={loadMore}`.

- [ ] **Step 1: Add dep**

In `package.json` dependencies add `react-virtuoso`. Run `npm install`.

- [ ] **Step 2: Write the failing test (CommitRow — the pure, testable unit)**

Create `src/railway/CommitRow.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { CommitRow } from "./CommitRow"

const commit = {
	hash: "abcdef1234567890",
	parents: ["p"],
	author_name: "Ada",
	author_email: "ada@x.io",
	timestamp_ms: 1_700_000_000_000,
	refs: ["HEAD -> main", "origin/main"],
	subject: "Add the thing",
}

describe("CommitRow", () => {
	it("shows subject, author, short hash and ref labels", () => {
		render(
			<CommitRow
				commit={commit}
				nowMs={1_700_000_030_000}
				selected={false}
				onClick={vi.fn()}
			/>,
		)
		expect(screen.getByText("Add the thing")).toBeInTheDocument()
		expect(screen.getByText("Ada")).toBeInTheDocument()
		expect(screen.getByText("abcdef1")).toBeInTheDocument() // 7-char short hash
		expect(screen.getByText("main")).toBeInTheDocument() // ref label, arrow stripped
		expect(screen.getByText("origin/main")).toBeInTheDocument()
	})

	it("fires onClick", async () => {
		const onClick = vi.fn()
		render(
			<CommitRow commit={commit} nowMs={Date.now()} selected={false} onClick={onClick} />,
		)
		await userEvent.click(screen.getByText("Add the thing"))
		expect(onClick).toHaveBeenCalledOnce()
	})
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/railway/CommitRow.test.tsx`
Expected: FAIL — cannot find `./CommitRow`.

- [ ] **Step 4: Implement `CommitRow`**

Create `src/railway/CommitRow.tsx`:
```tsx
import type { CommitSummary } from "../ipc/bindings"
import { formatRelative } from "../time"

function refLabel(ref: string): string {
	// "HEAD -> main" → "main"; "tag: v1" → "v1"
	return ref.replace(/^HEAD -> /, "").replace(/^tag: /, "")
}

export function CommitRow({
	commit,
	nowMs,
	selected,
	onClick,
}: {
	commit: CommitSummary
	nowMs: number
	selected: boolean
	onClick: () => void
}) {
	return (
		<button
			type="button"
			className={`commit-row ${selected ? "is-selected" : ""}`}
			onClick={onClick}
		>
			<div className="commit-row-main">
				{commit.refs.map((r) => (
					<span key={r} className="commit-ref">
						{refLabel(r)}
					</span>
				))}
				<span className="commit-subject">{commit.subject}</span>
			</div>
			<div className="commit-row-meta">
				<span className="commit-author">{commit.author_name}</span>
				<span className="commit-hash">{commit.hash.slice(0, 7)}</span>
				<span className="commit-date">{formatRelative(commit.timestamp_ms, nowMs)}</span>
			</div>
		</button>
	)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/railway/CommitRow.test.tsx`
Expected: PASS (2).

- [ ] **Step 6: Implement `useCommits` and `CommitRailway`**

Create `src/workspace/useCommits.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from "react"
import { commands, type CommitSummary } from "../ipc/bindings"

export function useCommits(repoPath: string, pageSize: number) {
	const [commits, setCommits] = useState<CommitSummary[]>([])
	const [loading, setLoading] = useState(false)
	const [reachedEnd, setReachedEnd] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const skipRef = useRef(0)

	const loadMore = useCallback(async () => {
		if (loading || reachedEnd) {
			return
		}
		setLoading(true)
		const result = await commands.logCommits(repoPath, skipRef.current, pageSize)
		if (result.status === "ok") {
			const page = result.data
			skipRef.current += page.length
			setCommits((prev) => [...prev, ...page])
			if (page.length < pageSize) {
				setReachedEnd(true)
			}
		} else {
			setError(
				result.error.kind === "NonZero" ? result.error.stderr : "Failed to read history",
			)
			setReachedEnd(true)
		}
		setLoading(false)
	}, [repoPath, pageSize, loading, reachedEnd])

	// Reset and load the first page whenever the repo changes.
	useEffect(() => {
		setCommits([])
		setReachedEnd(false)
		setError(null)
		skipRef.current = 0
	}, [repoPath])

	useEffect(() => {
		if (commits.length === 0 && !reachedEnd && !loading && error === null) {
			loadMore()
		}
	}, [commits.length, reachedEnd, loading, error, loadMore])

	return { commits, loadMore, loading, reachedEnd, error }
}
```
Create `src/railway/CommitRailway.tsx`:
```tsx
import { useMemo } from "react"
import { Virtuoso } from "react-virtuoso"
import type { CommitSummary } from "../ipc/bindings"
import { useCommits } from "../workspace/useCommits"
import { CommitRow } from "./CommitRow"
import "./CommitRailway.css"

export function CommitRailway({
	repoPath,
	selectedHash,
	onSelect,
}: {
	repoPath: string
	selectedHash: string | null
	onSelect: (commit: CommitSummary) => void
}) {
	const { commits, loadMore, error } = useCommits(repoPath, 100)
	const nowMs = useMemo(() => Date.now(), [commits.length])

	if (error !== null) {
		return <div className="railway-error">{error}</div>
	}
	return (
		<div className="railway">
			<Virtuoso
				data={commits}
				endReached={() => loadMore()}
				itemContent={(_i, commit) => (
					<CommitRow
						commit={commit}
						nowMs={nowMs}
						selected={commit.hash === selectedHash}
						onClick={() => onSelect(commit)}
					/>
				)}
			/>
		</div>
	)
}
```
Create `src/railway/CommitRailway.css`:
```css
.railway {
	height: 100%;
	overflow: hidden;
}
.railway-error {
	padding: 16px;
	color: var(--danger-fg);
}
.commit-row {
	width: 100%;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 8px 14px;
	background: none;
	border: none;
	border-bottom: 1px solid var(--border);
	text-align: left;
}
.commit-row:hover {
	background: var(--surface-hover);
}
.commit-row.is-selected {
	background: color-mix(in srgb, var(--accent) 16%, transparent);
}
.commit-row-main {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}
.commit-subject {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.commit-ref {
	flex: none;
	font-size: 11px;
	padding: 1px 6px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--accent) 18%, transparent);
	color: var(--accent);
	border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
}
.commit-row-meta {
	flex: none;
	display: flex;
	align-items: center;
	gap: 12px;
	color: var(--muted);
	font-size: 12px;
}
.commit-hash {
	font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
```

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npx vitest run && npm run build`
Expected: PASS. (`color-mix` is supported in the app's WebView; it degrades gracefully.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: virtualized paginated commit railway"
```

---

### Task 10: Commit detail (changed files) + Workspace assembly

The right panel (changed files → selecting one loads its diff) and the `Workspace` that wires railway + detail + diff + console, replacing `WorkspacePlaceholder`.

**Files:**
- Create: `src/detail/CommitDetail.tsx`, `src/detail/CommitDetail.css`
- Create: `src/workspace/Workspace.tsx`, `src/workspace/Workspace.css`
- Modify: `src/App.tsx` (render `Workspace`)
- Delete: `src/workspace/WorkspacePlaceholder.tsx`
- Modify: `src/App.test.tsx` (the workspace assertion — see Step 5)

**Interfaces:**
- Consumes: `CommitRailway` (Task 9), `DiffView` (Task 7), `GitConsole` + `useGitConsole` (Task 8), `commands.commitFiles`/`commands.fileDiff`, `FileChange`/`CommitSummary` types, `Repo` type.
- Produces:
  - `<CommitDetail repoPath onFileDiff selectedCommit={CommitSummary | null} />` — loads changed files for the selected commit; clicking a file loads its diff and calls `onFileDiff(diff)`.
  - `<Workspace repo={Repo} onBack={() => void} />` — the full read layout.

- [ ] **Step 1: Implement `CommitDetail`**

Create `src/detail/CommitDetail.tsx`:
```tsx
import { useEffect, useState } from "react"
import { commands, type CommitSummary, type FileChange } from "../ipc/bindings"
import "./CommitDetail.css"

export function CommitDetail({
	repoPath,
	selectedCommit,
	onFileDiff,
}: {
	repoPath: string
	selectedCommit: CommitSummary | null
	onFileDiff: (diff: string) => void
}) {
	const [files, setFiles] = useState<FileChange[]>([])
	const [activePath, setActivePath] = useState<string | null>(null)

	useEffect(() => {
		setActivePath(null)
		setFiles([])
		onFileDiff("")
		if (selectedCommit === null) {
			return
		}
		commands.commitFiles(repoPath, selectedCommit.hash).then((r) => {
			if (r.status === "ok") {
				setFiles(r.data)
			}
		})
	}, [repoPath, selectedCommit, onFileDiff])

	async function openFile(path: string) {
		if (selectedCommit === null) {
			return
		}
		setActivePath(path)
		const r = await commands.fileDiff(repoPath, selectedCommit.hash, path)
		onFileDiff(r.status === "ok" ? r.data : "")
	}

	if (selectedCommit === null) {
		return <div className="detail-empty">Select a commit to see its changes.</div>
	}
	return (
		<div className="detail">
			<div className="detail-subject">{selectedCommit.subject}</div>
			<ul className="detail-files">
				{files.map((f) => (
					<li key={f.path}>
						<button
							type="button"
							className={`detail-file ${activePath === f.path ? "is-active" : ""}`}
							onClick={() => openFile(f.path)}
						>
							<span className={`detail-status s-${f.status[0]}`}>{f.status}</span>
							<span className="detail-path">{f.path}</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	)
}
```
Create `src/detail/CommitDetail.css`:
```css
.detail,
.detail-empty {
	height: 100%;
	overflow-y: auto;
}
.detail-empty {
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--muted);
	padding: 16px;
	text-align: center;
}
.detail-subject {
	padding: 10px 12px;
	font-weight: 600;
	border-bottom: 1px solid var(--border);
}
.detail-files {
	list-style: none;
	margin: 0;
	padding: 4px;
}
.detail-file {
	width: 100%;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	background: none;
	border: none;
	border-radius: 6px;
	text-align: left;
}
.detail-file:hover {
	background: var(--surface-hover);
}
.detail-file.is-active {
	background: color-mix(in srgb, var(--accent) 16%, transparent);
}
.detail-status {
	flex: none;
	width: 20px;
	font-family: ui-monospace, monospace;
	font-size: 11px;
	color: var(--muted);
}
.detail-status.s-A {
	color: #2ea043;
}
.detail-status.s-D {
	color: var(--danger-fg);
}
.detail-path {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: ui-monospace, monospace;
	font-size: 12px;
}
```

- [ ] **Step 2: Implement `Workspace`**

Create `src/workspace/Workspace.tsx`:
```tsx
import { useState } from "react"
import { CommitDetail } from "../detail/CommitDetail"
import { DiffView } from "../diff/DiffView"
import { GitConsole } from "../console/GitConsole"
import { useGitConsole } from "../console/useGitConsole"
import { CommitRailway } from "../railway/CommitRailway"
import type { CommitSummary, Repo } from "../ipc/bindings"
import "./Workspace.css"

export function Workspace({ repo, onBack }: { repo: Repo; onBack: () => void }) {
	const [selected, setSelected] = useState<CommitSummary | null>(null)
	const [diff, setDiff] = useState("")
	const [consoleOpen, setConsoleOpen] = useState(false)
	const { entries, clear } = useGitConsole(500)

	return (
		<div className="workspace">
			<header className="workspace-header">
				<button type="button" className="btn" onClick={onBack}>
					← Back
				</button>
				<h1>{repo.name}</h1>
				<span className="workspace-path">{repo.path}</span>
			</header>
			<div className="workspace-main">
				<div className="workspace-railway">
					<CommitRailway
						repoPath={repo.path}
						selectedHash={selected?.hash ?? null}
						onSelect={setSelected}
					/>
				</div>
				<div className="workspace-detail">
					<CommitDetail
						repoPath={repo.path}
						selectedCommit={selected}
						onFileDiff={setDiff}
					/>
				</div>
				<div className="workspace-diff">
					<DiffView diff={diff} />
				</div>
			</div>
			<GitConsole
				entries={entries}
				open={consoleOpen}
				onToggle={() => setConsoleOpen((o) => !o)}
				onClear={clear}
			/>
		</div>
	)
}
```
Create `src/workspace/Workspace.css`:
```css
.workspace {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}
.workspace-header {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 16px;
	border-bottom: 1px solid var(--border);
}
.workspace-header h1 {
	margin: 0;
	font-size: 16px;
	font-weight: 600;
}
.workspace-path {
	color: var(--muted);
	font-size: 12px;
	font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
.workspace-main {
	flex: 1;
	min-height: 0;
	display: grid;
	grid-template-columns: minmax(320px, 1.4fr) minmax(220px, 0.8fr) minmax(360px, 2fr);
}
.workspace-railway,
.workspace-detail,
.workspace-diff {
	min-height: 0;
	overflow: hidden;
	border-right: 1px solid var(--border);
}
.workspace-diff {
	border-right: none;
}
```

- [ ] **Step 3: Wire `App` to render `Workspace` and delete the placeholder**

In `src/App.tsx`: replace the `WorkspacePlaceholder` import with `import { Workspace } from "./workspace/Workspace"`, and render `<Workspace repo={selected} onBack={() => setSelected(null)} />` in place of `<WorkspacePlaceholder .../>`. Delete `src/workspace/WorkspacePlaceholder.tsx`.

- [ ] **Step 4: Update `App.test.tsx` for the new workspace**

The existing App test relies on a bindings mock. The new `Workspace` calls `commands.logCommits` and subscribes to `events.gitConsoleEntry`, so extend the mock in `src/App.test.tsx`:
- add `logCommits: vi.fn().mockResolvedValue({ status: "ok", data: [] })` to the `commands` mock,
- add an `events` object: `events: { gitConsoleEntry: { listen: vi.fn().mockResolvedValue(() => {}) } }`.
Keep the existing assertions: after opening the repo, the workspace header still renders the repo name as the `heading` (`<h1>`) and the `Back` button — those are unchanged in `Workspace`. So the test body stays the same aside from the mock additions.

Exact replacement for the `vi.mock("./ipc/bindings", ...)` block:
```tsx
vi.mock("./ipc/bindings", () => ({
	commands: {
		gitStatus: vi.fn().mockResolvedValue({ available: true, version: "2.44.0" }),
		listRepos: vi.fn().mockResolvedValue({
			status: "ok",
			data: [{ id: "1", name: "omni-git", path: "/code/omni-git" }],
		}),
		addRepo: vi.fn(),
		removeRepo: vi.fn(),
		logCommits: vi.fn().mockResolvedValue({ status: "ok", data: [] }),
	},
	events: {
		gitConsoleEntry: { listen: vi.fn().mockResolvedValue(() => {}) },
	},
}))
```

- [ ] **Step 5: Run the full suite + typecheck + backend build**

Run: `npx vitest run && npm run build && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: all green. Full frontend suite includes App, launcher, filter, theme, time, diffHighlight, DiffView, GitConsole, CommitRow.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: commit detail, diff wiring, and read-only Workspace"
```

---

## Self-Review

**Spec coverage (M2a slice of the design spec):**
- Commit railway with the list of commits → Tasks 9 (railway) + 5 (dates) ✓
- Branches distinguishable / ref labels on commits → Task 9 `CommitRow` ref chips ✓ (multi-lane graph drawing is Milestone 3, explicitly deferred) ✓
- Select a commit → affected files → Task 10 `CommitDetail` ✓
- Select a file → visualized diff → Tasks 6–7 `DiffView` ✓
- Git console showing every git invocation + stderr, toggleable, lazy when hidden → Tasks 1 (event) + 8 (panel; body only rendered when `open`) ✓
- Incremental/paginated history (no loading all at once) → Tasks 2 + 9 (`--skip`/`--max-count`, virtuoso `endReached`) ✓
- System git only, all via one wrapper → Task 1 ✓
- Deferred to later milestones and NOT in this plan: sidebar listings + FS-watch (M2b), graph lane drawing (M3), working-changes row + staging + commit + push/pull (M4), side-by-side diff + syntax highlighting (later diff enhancement). ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. The DiffView "No changes to display" and detail "Select a commit…" strings are intended UI copy, not plan placeholders. ✓

**Type consistency:** `CommitSummary` fields (`hash`, `parents`, `author_name`, `author_email`, `timestamp_ms`, `refs`, `subject`) are used identically in Rust (Task 2) and every frontend consumer (Tasks 9–10). `FileChange { status, path }` consistent (Tasks 3, 10). `GitConsoleEntry` fields consistent between the Rust struct (Task 1, snake_case) and the TS mock/consumers (camelCase — tauri-specta camelCases fields; the test mocks and `GitConsole.tsx` use `exitCode`/`durationMs`/`timestampMs` accordingly). `GitError` variants (`Spawn`, `NonZero { code, stderr }`) referenced consistently in `useCommits` error handling (Task 9). Command names `log_commits`/`logCommits`, `commit_files`/`commitFiles`, `file_diff`/`fileDiff` consistent (Tasks 4, 9, 10).

**Known risks flagged for execution:**
1. tauri-specta **event** generation — the exact frontend accessor (`events.gitConsoleEntry.listen`) and field casing depend on the installed tauri-specta version; Tasks 1/8 tell the implementer to match the actual generated `bindings.ts`. This is the main integration risk (events are newer than commands in our usage).
2. CodeMirror under jsdom — DiffView's test may need a tiny layout polyfill in `src/test-setup.ts`; Task 7 Step 4 notes this, to be added only if a test error demands it.
