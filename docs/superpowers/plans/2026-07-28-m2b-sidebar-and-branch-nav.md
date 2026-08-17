# Milestone 2b — Sidebar & Branch Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the left sidebar listing the repo's local branches, remote branches (grouped by remote), tags, worktrees, and stashes — with the checked-out branch highlighted — and let the user click any branch or tag to browse *its* history in the commit railway. Include a manual Refresh action.

**Architecture:** New Rust read commands (`list_refs`, `list_worktrees`, `list_stashes`) built on the existing `git::run` wrapper, exposed via typed IPC. The commit-loading path gains an optional `rev` so the railway can show any ref's history. A new `Sidebar` React component (fed by a `useRepoRefs` hook) sits as a new left column in `Workspace`; selecting a ref drives the railway. This is milestone 2b of v1; it produces a working branch-browsing UI on its own. FS-watch live refresh and the git-console ring buffer are deferred to M2c.

**Tech Stack:** Existing (Tauri 2, Rust, React 18, TS7, tauri-specta 2, Biome, Vitest). No new dependencies.

## Global Constraints

Apply to **every** task.

- **System git only** — all git interaction shells out via the existing `git::run::run(app, repo_path, args)` wrapper (which logs every call to the console). Never spawn `git` directly; never a git library. Always `git -C <repo_path> …`.
- **Frontend never touches git/fs directly** — only generated bindings from `src/ipc/bindings.ts` (git-ignored, generated).
- **Regenerate bindings HEADLESSLY** with `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` — do NOT run `npm run tauri dev` (no display). Never hand-edit or commit `src/ipc/bindings.ts`.
- **New commands register by ADDING to the existing `collect_commands![...]`** in `specta_builder()` (`src-tauri/src/lib.rs`). Do not create a second `Builder`; leave `.events(...)` intact.
- **Generated TS types are snake_case** (no `rename_all`). `Result`-wrapped commands return `{ status: "ok", data } | { status: "error", error }`; `GitError` is externally-tagged `{ Spawn: string } | { NonZero: { code, stderr } }`.
- **TypeScript 7; Biome 2.5.4 verbatim** (tab indent, double quotes, semicolons `asNeeded`, trailing commas `all`). Run `npm run format` then `npm run lint` before committing; the one pre-existing info-level biome notice is expected.
- **Theme-aware CSS** — use the tokens in `src/theme/theme.css` (`--bg`, `--surface`, `--surface-hover`, `--fg`, `--muted`, `--border`, `--accent`, `--added`, `--danger-fg`, …). No hardcoded colors; both light and dark must read well.
- **Truncated text gets a `title` tooltip**; long ref/path names truncate with ellipsis (project convention established in M2a).
- **Frequent commits** — each task ends by committing; never stage `src/ipc/bindings.ts`.
- **Commit author** if unset: `-c user.name='Vaclav Purchart' -c user.email='vaclav.purchart@finshape.com'`.

## File Structure

Backend (`src-tauri/src/`):
- `git/refs.rs` (new) — parse `list_refs` (branches/remotes/tags) + `RepoRefs` type.
- `git/worktrees.rs` (new) — parse `git worktree list --porcelain`.
- `git/stashes.rs` (new) — parse `git stash list`.
- `git/log.rs` (modify) — `log_commits` gains an optional `rev`.
- `git/mod.rs` (modify) — declare new modules.
- `commands/repo_refs.rs` (new) — command wrappers for refs/worktrees/stashes.
- `commands/repo_read.rs` (modify) — thread `rev` into the `log_commits` command.
- `commands/mod.rs`, `lib.rs` (modify) — register commands.

Frontend (`src/`):
- `sidebar/useRepoRefs.ts` (new) — fetches refs/worktrees/stashes.
- `sidebar/Sidebar.tsx` + `.css` (new) — the panel.
- `sidebar/Sidebar.test.tsx` (new).
- `sidebar/SidebarSection.tsx` (new) — a collapsible section (small, reused).
- `workspace/useCommits.ts` (modify) — accept `rev`.
- `railway/CommitRailway.tsx` (modify) — accept + pass `rev`.
- `workspace/Workspace.tsx` + `.css` (modify) — add the sidebar column, active-rev state, Refresh button.
- `src/App.test.tsx` (modify) — extend the bindings mock for the new commands.

---

### Task 1: `list_refs` — branches, remotes, tags

Parse the repo's refs into a structured, categorized shape, marking the checked-out branch.

**Files:**
- Create: `src-tauri/src/git/refs.rs`
- Modify: `src-tauri/src/git/mod.rs`

**Interfaces:**
- Consumes: `git::run::{run, GitError}`.
- Produces:
  - `#[derive(Clone, Serialize, specta::Type)] pub struct LocalBranch { pub name: String, pub is_head: bool, pub upstream: Option<String> }`
  - `#[derive(Clone, Serialize, specta::Type)] pub struct RemoteBranch { pub name: String, pub remote: String }` (`name` is the short form incl. remote, e.g. `origin/main`)
  - `#[derive(Clone, Serialize, specta::Type)] pub struct RepoRefs { pub local: Vec<LocalBranch>, pub remotes: Vec<RemoteBranch>, pub tags: Vec<String>, pub current: Option<String> }`
  - `pub fn list_refs(app: &tauri::AppHandle, repo_path: &str) -> Result<RepoRefs, GitError>`

- [ ] **Step 1: Write the failing tests (pure parsers)**

Create `src-tauri/src/git/refs.rs`:
```rust
use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct LocalBranch {
	pub name: String,
	pub is_head: bool,
	pub upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RemoteBranch {
	pub name: String,
	pub remote: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RepoRefs {
	pub local: Vec<LocalBranch>,
	pub remotes: Vec<RemoteBranch>,
	pub tags: Vec<String>,
	pub current: Option<String>,
}

// for-each-ref line for locals: "<name>\x1f<head>\x1f<upstream>" where <head>
// is "*" for the checked-out branch, "" otherwise.
pub fn parse_locals(stdout: &str) -> Vec<LocalBranch> {
	stdout
		.lines()
		.filter(|l| !l.trim().is_empty())
		.map(|l| {
			let f: Vec<&str> = l.split('\u{1f}').collect();
			let name = f.first().copied().unwrap_or("").to_string();
			let is_head = f.get(1).copied().unwrap_or("") == "*";
			let up = f.get(2).copied().unwrap_or("");
			let upstream = if up.is_empty() {
				None
			} else {
				Some(up.to_string())
			};
			LocalBranch {
				name,
				is_head,
				upstream,
			}
		})
		.collect()
}

// Remote short names like "origin/main"; skip the "<remote>/HEAD" symbolic ref.
pub fn parse_remotes(stdout: &str) -> Vec<RemoteBranch> {
	stdout
		.lines()
		.map(|l| l.trim())
		.filter(|l| !l.is_empty() && !l.ends_with("/HEAD"))
		.map(|l| {
			let remote = l.split('/').next().unwrap_or("").to_string();
			RemoteBranch {
				name: l.to_string(),
				remote,
			}
		})
		.collect()
}

pub fn parse_tags(stdout: &str) -> Vec<String> {
	stdout
		.lines()
		.map(|l| l.trim().to_string())
		.filter(|l| !l.is_empty())
		.collect()
}

pub fn list_refs(app: &tauri::AppHandle, repo_path: &str) -> Result<RepoRefs, GitError> {
	let locals_out = run(
		app,
		repo_path,
		&[
			"for-each-ref",
			"--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)",
			"refs/heads",
		],
	)?;
	let remotes_out = run(
		app,
		repo_path,
		&["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
	)?;
	let tags_out = run(
		app,
		repo_path,
		&["for-each-ref", "--format=%(refname:short)", "refs/tags"],
	)?;
	let local = parse_locals(&locals_out);
	let current = local.iter().find(|b| b.is_head).map(|b| b.name.clone());
	Ok(RepoRefs {
		local,
		remotes: parse_remotes(&remotes_out),
		tags: parse_tags(&tags_out),
		current,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_locals_with_head_and_upstream() {
		let out = "main\u{1f}*\u{1f}origin/main\nfeature\u{1f}\u{1f}\n";
		let locals = parse_locals(out);
		assert_eq!(locals.len(), 2);
		assert_eq!(locals[0].name, "main");
		assert!(locals[0].is_head);
		assert_eq!(locals[0].upstream.as_deref(), Some("origin/main"));
		assert_eq!(locals[1].name, "feature");
		assert!(!locals[1].is_head);
		assert_eq!(locals[1].upstream, None);
	}

	#[test]
	fn parses_remotes_and_skips_head_pointer() {
		let out = "origin/HEAD\norigin/main\nupstream/dev\n";
		let remotes = parse_remotes(out);
		assert_eq!(remotes.len(), 2);
		assert_eq!(remotes[0].name, "origin/main");
		assert_eq!(remotes[0].remote, "origin");
		assert_eq!(remotes[1].remote, "upstream");
	}

	#[test]
	fn parses_tags() {
		assert_eq!(parse_tags("v1.0\nv1.1\n"), vec!["v1.0", "v1.1"]);
		assert!(parse_tags("").is_empty());
	}
}
```
Add `pub mod refs;` to `src-tauri/src/git/mod.rs`.

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::refs`
Expected: 3 tests PASS. (`list_refs` itself is exercised via the command in Task 4 / manual use; the parsers carry the logic and are unit-tested here.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: list_refs (local/remote branches, tags) parsing"
```

---

### Task 2: `list_worktrees` + `list_stashes`

Parse worktrees and stashes for the sidebar's read-only listings.

**Files:**
- Create: `src-tauri/src/git/worktrees.rs`, `src-tauri/src/git/stashes.rs`
- Modify: `src-tauri/src/git/mod.rs`

**Interfaces:**
- Consumes: `git::run::{run, GitError}`.
- Produces:
  - `#[derive(Clone, Serialize, specta::Type)] pub struct Worktree { pub path: String, pub branch: Option<String>, pub is_detached: bool }`
  - `pub fn list_worktrees(app, repo_path) -> Result<Vec<Worktree>, GitError>`
  - `#[derive(Clone, Serialize, specta::Type)] pub struct Stash { pub selector: String, pub message: String }` (`selector` e.g. `stash@{0}`)
  - `pub fn list_stashes(app, repo_path) -> Result<Vec<Stash>, GitError>`

- [ ] **Step 1: Write the failing tests (pure parsers)**

Create `src-tauri/src/git/worktrees.rs`:
```rust
use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct Worktree {
	pub path: String,
	pub branch: Option<String>,
	pub is_detached: bool,
}

// `git worktree list --porcelain`: records separated by blank lines, each with
// "worktree <path>", optional "branch refs/heads/<name>" or "detached".
pub fn parse_worktrees(stdout: &str) -> Vec<Worktree> {
	let mut out = Vec::new();
	let mut path: Option<String> = None;
	let mut branch: Option<String> = None;
	let mut detached = false;
	let mut flush = |path: &mut Option<String>, branch: &mut Option<String>, detached: &mut bool, out: &mut Vec<Worktree>| {
		if let Some(p) = path.take() {
			out.push(Worktree {
				path: p,
				branch: branch.take(),
				is_detached: *detached,
			});
		}
		*detached = false;
	};
	for line in stdout.lines() {
		if let Some(p) = line.strip_prefix("worktree ") {
			flush(&mut path, &mut branch, &mut detached, &mut out);
			path = Some(p.to_string());
		} else if let Some(b) = line.strip_prefix("branch ") {
			branch = Some(b.trim_start_matches("refs/heads/").to_string());
		} else if line.trim() == "detached" {
			detached = true;
		}
	}
	flush(&mut path, &mut branch, &mut detached, &mut out);
	out
}

pub fn list_worktrees(app: &tauri::AppHandle, repo_path: &str) -> Result<Vec<Worktree>, GitError> {
	let out = run(app, repo_path, &["worktree", "list", "--porcelain"])?;
	Ok(parse_worktrees(&out))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_main_and_linked_worktree() {
		let out = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-wt\nHEAD def\ndetached\n";
		let wts = parse_worktrees(out);
		assert_eq!(wts.len(), 2);
		assert_eq!(wts[0].path, "/repo");
		assert_eq!(wts[0].branch.as_deref(), Some("main"));
		assert!(!wts[0].is_detached);
		assert_eq!(wts[1].path, "/repo-wt");
		assert_eq!(wts[1].branch, None);
		assert!(wts[1].is_detached);
	}
}
```
Create `src-tauri/src/git/stashes.rs`:
```rust
use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct Stash {
	pub selector: String,
	pub message: String,
}

// `git stash list --format=%gd%x1f%s` → "stash@{0}\x1f<message>".
pub fn parse_stashes(stdout: &str) -> Vec<Stash> {
	stdout
		.lines()
		.filter(|l| !l.trim().is_empty())
		.map(|l| {
			let mut parts = l.splitn(2, '\u{1f}');
			let selector = parts.next().unwrap_or("").to_string();
			let message = parts.next().unwrap_or("").to_string();
			Stash { selector, message }
		})
		.collect()
}

pub fn list_stashes(app: &tauri::AppHandle, repo_path: &str) -> Result<Vec<Stash>, GitError> {
	let out = run(app, repo_path, &["stash", "list", "--format=%gd%x1f%s"])?;
	Ok(parse_stashes(&out))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_stashes() {
		let out = "stash@{0}\u{1f}WIP on main: abc feature\nstash@{1}\u{1f}On dev: fix\n";
		let s = parse_stashes(out);
		assert_eq!(s.len(), 2);
		assert_eq!(s[0].selector, "stash@{0}");
		assert_eq!(s[0].message, "WIP on main: abc feature");
		assert_eq!(s[1].selector, "stash@{1}");
	}

	#[test]
	fn empty_yields_none() {
		assert!(parse_stashes("").is_empty());
	}
}
```
Add `pub mod worktrees;` and `pub mod stashes;` to `src-tauri/src/git/mod.rs`.

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml "git::worktrees" && cargo test --manifest-path src-tauri/Cargo.toml "git::stashes"`
Expected: worktree test + 2 stash tests PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: list_worktrees and list_stashes parsing"
```

---

### Task 3: Thread an optional `rev` through `log_commits`

Let the railway show any ref's history (not just HEAD).

**Files:**
- Modify: `src-tauri/src/git/log.rs`, `src-tauri/src/commands/repo_read.rs`
- Modify: `src/workspace/useCommits.ts`, `src/workspace/useCommits.test.ts`, `src/railway/CommitRailway.tsx`

**Interfaces:**
- Changed: `pub fn log_commits(app, repo_path, rev: Option<&str>, skip, limit) -> Result<Vec<CommitSummary>, GitError>` — when `rev` is `Some(r)`, pass `r` as the revision to `git log`; when `None`, default to HEAD.
- Changed command: `log_commits(repo_path: String, rev: Option<String>, skip: u32, limit: u32)` → generated `commands.logCommits(repoPath, rev, skip, limit)`.
- Changed hook: `useCommits(repoPath: string, rev: string | null, pageSize: number)`.
- Changed component: `<CommitRailway repoPath rev={string | null} selectedHash onSelect />`.

- [ ] **Step 1: Update `log_commits` (Rust)**

In `src-tauri/src/git/log.rs`, change the signature and argument building:
```rust
pub fn log_commits(
	app: &tauri::AppHandle,
	repo_path: &str,
	rev: Option<&str>,
	skip: u32,
	limit: u32,
) -> Result<Vec<CommitSummary>, GitError> {
	let format_arg = format!("--pretty=format:{}", FORMAT);
	let skip_arg = format!("--skip={}", skip);
	let max_arg = format!("--max-count={}", limit);
	let mut args: Vec<&str> = vec!["log", "--decorate=short", &format_arg, &skip_arg, &max_arg];
	if let Some(r) = rev {
		args.push(r);
	}
	let stdout = run(app, repo_path, &args)?;
	Ok(parse_log(&stdout))
}
```
(Keep `FORMAT`, `parse_log`, `parse_line`, and their tests unchanged — the parser tests still pass.)

- [ ] **Step 2: Update the command wrapper (Rust)**

In `src-tauri/src/commands/repo_read.rs`, change `log_commits`:
```rust
#[tauri::command]
#[specta::specta]
pub fn log_commits(
	app: tauri::AppHandle,
	repo_path: String,
	rev: Option<String>,
	skip: u32,
	limit: u32,
) -> Result<Vec<CommitSummary>, GitError> {
	gl(&app, &repo_path, rev.as_deref(), skip, limit)
}
```

- [ ] **Step 3: Rebuild + regenerate bindings**

Run: `cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml export_bindings`
Expected: builds; `commands.logCommits` now takes `(repoPath, rev, skip, limit)` with `rev: string | null`.

- [ ] **Step 4: Update `useCommits` (frontend)**

In `src/workspace/useCommits.ts`, add a `rev: string | null` parameter and thread it into the call and the reset dependencies:
```ts
export function useCommits(repoPath: string, rev: string | null, pageSize: number) {
	// ...existing state/refs...
	const loadMore = useCallback(async () => {
		if (loadingRef.current || reachedEnd) {
			return
		}
		loadingRef.current = true
		setLoading(true)
		const gen = genRef.current
		const result = await commands.logCommits(repoPath, rev, skipRef.current, pageSize)
		if (genRef.current !== gen) {
			loadingRef.current = false
			return
		}
		// ...existing ok/error handling, then loadingRef.current = false...
	}, [repoPath, rev, pageSize, reachedEnd])

	// reset effect now also depends on rev:
	useEffect(() => {
		genRef.current += 1
		setCommits([])
		setReachedEnd(false)
		setError(null)
		skipRef.current = 0
		setLoading(false)
		loadingRef.current = false
	}, [repoPath, rev])
	// ...
}
```
Adjust to match the exact current structure of `useCommits.ts` (it already has `genRef`/`loadingRef`); the only functional change is adding `rev` as a parameter, passing it to `commands.logCommits`, and adding it to the reset effect's dependency array so switching refs reloads.

- [ ] **Step 5: Update `useCommits.test.ts`**

The existing race test calls `useCommits(repoPath, pageSize)` and mocks `commands.logCommits`. Update every `renderHook(() => useCommits("A", 50))` call to `useCommits("A", null, 50)` (and `"B"` → `useCommits("B", null, 50)`), and if the mock asserts call arguments, update them to the new arity `(repoPath, null, skip, limit)`. Keep the assertions' behavior identical.

- [ ] **Step 6: Update `CommitRailway` (frontend)**

In `src/railway/CommitRailway.tsx`, add a `rev: string | null` prop and pass it to `useCommits`:
```tsx
export function CommitRailway({
	repoPath,
	rev,
	selectedHash,
	onSelect,
}: {
	repoPath: string
	rev: string | null
	selectedHash: string | null
	onSelect: (commit: CommitSummary) => void
}) {
	const { commits, loadMore, error } = useCommits(repoPath, rev, 100)
	// ...unchanged...
}
```

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run build`
Expected: PASS. (Workspace still passes `rev={null}` implicitly? No — update the Workspace call in Task 6. For now `npm run build` will FAIL on the `CommitRailway` usage in Workspace until Task 6; that's expected — do Steps 1-6, commit, and let Task 6 fix the Workspace call. To keep this task independently green, ALSO make the minimal Workspace edit here: pass `rev={null}` to `<CommitRailway>` so the build passes, and Task 6 replaces it with real state.)

Minimal Workspace edit to keep the build green: in `src/workspace/Workspace.tsx`, change `<CommitRailway repoPath={repo.path} selectedHash=... onSelect=... />` to include `rev={null}`.

Re-run: `npx vitest run && npm run build` → PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: optional rev for log_commits so railway can show any ref"
```

---

### Task 4: Ref/worktree/stash IPC commands + `useRepoRefs` hook

Expose the Task 1/2 functions and provide a frontend hook that loads all three.

**Files:**
- Create: `src-tauri/src/commands/repo_refs.rs`
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`
- Create: `src/sidebar/useRepoRefs.ts`

**Interfaces:**
- Consumes: `git::refs::{list_refs, RepoRefs}`, `git::worktrees::{list_worktrees, Worktree}`, `git::stashes::{list_stashes, Stash}`, `git::run::GitError`.
- Produces commands: `list_refs(repo_path) -> Result<RepoRefs, GitError>`, `list_worktrees(repo_path) -> Result<Vec<Worktree>, GitError>`, `list_stashes(repo_path) -> Result<Vec<Stash>, GitError>` (generated `commands.listRefs`, `commands.listWorktrees`, `commands.listStashes`).
- Produces hook: `useRepoRefs(repoPath: string)` → `{ refs: RepoRefs | null, worktrees: Worktree[], stashes: Stash[], reload: () => void }`.

- [ ] **Step 1: Create the command wrappers**

Create `src-tauri/src/commands/repo_refs.rs`:
```rust
use crate::git::refs::{list_refs as lr, RepoRefs};
use crate::git::run::GitError;
use crate::git::stashes::{list_stashes as ls, Stash};
use crate::git::worktrees::{list_worktrees as lw, Worktree};

#[tauri::command]
#[specta::specta]
pub fn list_refs(app: tauri::AppHandle, repo_path: String) -> Result<RepoRefs, GitError> {
	lr(&app, &repo_path)
}

#[tauri::command]
#[specta::specta]
pub fn list_worktrees(
	app: tauri::AppHandle,
	repo_path: String,
) -> Result<Vec<Worktree>, GitError> {
	lw(&app, &repo_path)
}

#[tauri::command]
#[specta::specta]
pub fn list_stashes(app: tauri::AppHandle, repo_path: String) -> Result<Vec<Stash>, GitError> {
	ls(&app, &repo_path)
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/commands/mod.rs` add `pub mod repo_refs;`. In `src-tauri/src/lib.rs`, append to the existing `collect_commands![...]`: `commands::repo_refs::list_refs, commands::repo_refs::list_worktrees, commands::repo_refs::list_stashes`.

- [ ] **Step 3: Regenerate bindings, typecheck**

Run: `cargo test --manifest-path src-tauri/Cargo.toml export_bindings && npm run build`
Expected: `commands.listRefs`, `commands.listWorktrees`, `commands.listStashes` present; types `RepoRefs`, `LocalBranch`, `RemoteBranch`, `Worktree`, `Stash` exported (snake_case fields).

- [ ] **Step 4: Implement `useRepoRefs`**

Create `src/sidebar/useRepoRefs.ts`:
```ts
import { useCallback, useEffect, useState } from "react"
import {
	commands,
	type RepoRefs,
	type Stash,
	type Worktree,
} from "../ipc/bindings"

export function useRepoRefs(repoPath: string) {
	const [refs, setRefs] = useState<RepoRefs | null>(null)
	const [worktrees, setWorktrees] = useState<Worktree[]>([])
	const [stashes, setStashes] = useState<Stash[]>([])

	const reload = useCallback(async () => {
		const [r, w, s] = await Promise.all([
			commands.listRefs(repoPath),
			commands.listWorktrees(repoPath),
			commands.listStashes(repoPath),
		])
		if (r.status === "ok") {
			setRefs(r.data)
		}
		if (w.status === "ok") {
			setWorktrees(w.data)
		}
		if (s.status === "ok") {
			setStashes(s.data)
		}
	}, [repoPath])

	useEffect(() => {
		reload()
	}, [reload])

	return { refs, worktrees, stashes, reload }
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: refs/worktrees/stashes IPC commands and useRepoRefs hook"
```

---

### Task 5: Sidebar component

A collapsible-section panel listing refs; highlights the active ref; clicking a branch/tag raises `onSelectRef`.

**Files:**
- Create: `src/sidebar/SidebarSection.tsx`, `src/sidebar/Sidebar.tsx`, `src/sidebar/Sidebar.css`
- Create: `src/sidebar/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `useRepoRefs` (Task 4); types `RepoRefs`/`Worktree`/`Stash`.
- Produces:
  - `<SidebarSection title count children />` — a collapsible section (open by default), header shows title + count.
  - `<Sidebar repoPath activeRef onSelectRef />` where `activeRef: string | null` (null = current branch) and `onSelectRef: (ref: string | null) => void`. Renders sections: Local, Remotes (grouped by remote), Tags, Worktrees, Stashes. The checked-out branch (or `activeRef`) is highlighted. Clicking a local/remote branch or tag calls `onSelectRef(name)`.

- [ ] **Step 1: Write the failing test**

Create `src/sidebar/Sidebar.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Sidebar } from "./Sidebar"

vi.mock("./useRepoRefs", () => ({
	useRepoRefs: () => ({
		refs: {
			local: [
				{ name: "main", is_head: true, upstream: "origin/main" },
				{ name: "feature", is_head: false, upstream: null },
			],
			remotes: [{ name: "origin/main", remote: "origin" }],
			tags: ["v1.0"],
			current: "main",
		},
		worktrees: [{ path: "/repo", branch: "main", is_detached: false }],
		stashes: [{ selector: "stash@{0}", message: "WIP on main: x" }],
		reload: vi.fn(),
	}),
}))

describe("Sidebar", () => {
	it("lists local branches, remotes, tags, and marks the current branch", () => {
		render(<Sidebar repoPath="/repo" activeRef={null} onSelectRef={vi.fn()} />)
		expect(screen.getByText("feature")).toBeInTheDocument()
		expect(screen.getByText("v1.0")).toBeInTheDocument()
		expect(screen.getByText("origin/main")).toBeInTheDocument()
		// The checked-out branch row is marked current.
		const mainRow = screen.getByRole("button", { name: /main/ })
		expect(mainRow).toHaveClass("is-current")
	})

	it("calls onSelectRef with the branch name when clicked", async () => {
		const onSelectRef = vi.fn()
		render(
			<Sidebar repoPath="/repo" activeRef={null} onSelectRef={onSelectRef} />,
		)
		await userEvent.click(screen.getByText("feature"))
		expect(onSelectRef).toHaveBeenCalledWith("feature")
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sidebar/Sidebar.test.tsx`
Expected: FAIL — cannot find `./Sidebar`.

- [ ] **Step 3: Implement `SidebarSection`**

Create `src/sidebar/SidebarSection.tsx`:
```tsx
import { type ReactNode, useState } from "react"

export function SidebarSection({
	title,
	count,
	children,
}: {
	title: string
	count: number
	children: ReactNode
}) {
	const [open, setOpen] = useState(true)
	return (
		<div className="sidebar-section">
			<button
				type="button"
				className="sidebar-section-header"
				onClick={() => setOpen((o) => !o)}
			>
				<span className="sidebar-caret">{open ? "▾" : "▸"}</span>
				<span className="sidebar-section-title">{title}</span>
				<span className="sidebar-section-count">{count}</span>
			</button>
			{open && <div className="sidebar-section-body">{children}</div>}
		</div>
	)
}
```

- [ ] **Step 4: Implement `Sidebar`**

Create `src/sidebar/Sidebar.tsx`:
```tsx
import type { RemoteBranch } from "../ipc/bindings"
import { SidebarSection } from "./SidebarSection"
import { useRepoRefs } from "./useRepoRefs"
import "./Sidebar.css"

function groupByRemote(remotes: RemoteBranch[]): Map<string, RemoteBranch[]> {
	const map = new Map<string, RemoteBranch[]>()
	for (const rb of remotes) {
		const list = map.get(rb.remote) ?? []
		list.push(rb)
		map.set(rb.remote, list)
	}
	return map
}

export function Sidebar({
	repoPath,
	activeRef,
	onSelectRef,
}: {
	repoPath: string
	activeRef: string | null
	onSelectRef: (ref: string) => void
}) {
	const { refs, worktrees, stashes } = useRepoRefs(repoPath)
	if (refs === null) {
		return <div className="sidebar sidebar-loading">Loading…</div>
	}
	// The highlighted ref: the explicit selection, else the checked-out branch.
	const active = activeRef ?? refs.current
	const remoteGroups = [...groupByRemote(refs.remotes).entries()]

	const refButton = (name: string) => (
		<button
			type="button"
			className={`sidebar-ref ${name === active ? "is-current" : ""}`}
			title={name}
			onClick={() => onSelectRef(name)}
		>
			{name}
		</button>
	)

	return (
		<div className="sidebar">
			<SidebarSection title="Local" count={refs.local.length}>
				{refs.local.map((b) => (
					<div key={b.name} className="sidebar-row">
						<button
							type="button"
							className={`sidebar-ref ${b.name === active ? "is-current" : ""}`}
							title={b.upstream ? `${b.name} → ${b.upstream}` : b.name}
							onClick={() => onSelectRef(b.name)}
						>
							{b.is_head && <span className="sidebar-head-dot" aria-hidden="true" />}
							<span className="sidebar-ref-name">{b.name}</span>
						</button>
					</div>
				))}
			</SidebarSection>

			{remoteGroups.map(([remote, branches]) => (
				<SidebarSection key={remote} title={remote} count={branches.length}>
					{branches.map((rb) => (
						<div key={rb.name} className="sidebar-row">
							{refButton(rb.name)}
						</div>
					))}
				</SidebarSection>
			))}

			<SidebarSection title="Tags" count={refs.tags.length}>
				{refs.tags.map((t) => (
					<div key={t} className="sidebar-row">
						{refButton(t)}
					</div>
				))}
			</SidebarSection>

			<SidebarSection title="Worktrees" count={worktrees.length}>
				{worktrees.map((w) => (
					<div key={w.path} className="sidebar-row sidebar-static" title={w.path}>
						<span className="sidebar-ref-name">
							{w.branch ?? (w.is_detached ? "(detached)" : w.path)}
						</span>
					</div>
				))}
			</SidebarSection>

			<SidebarSection title="Stashes" count={stashes.length}>
				{stashes.map((s) => (
					<div
						key={s.selector}
						className="sidebar-row sidebar-static"
						title={s.message}
					>
						<span className="sidebar-ref-name">{s.message}</span>
					</div>
				))}
			</SidebarSection>
		</div>
	)
}
```
Create `src/sidebar/Sidebar.css`:
```css
.sidebar {
	height: 100%;
	overflow-y: auto;
	background: var(--surface);
	border-right: 1px solid var(--border);
	padding: 4px 0;
	font-size: 13px;
}
.sidebar-loading {
	padding: 16px;
	color: var(--muted);
}
.sidebar-section {
	margin-bottom: 2px;
}
.sidebar-section-header {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	padding: 4px 10px;
	background: none;
	border: none;
	color: var(--muted);
	font-weight: 600;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.03em;
}
.sidebar-caret {
	width: 10px;
}
.sidebar-section-count {
	margin-left: auto;
	font-weight: 400;
}
.sidebar-section-body {
	display: flex;
	flex-direction: column;
}
.sidebar-row {
	display: flex;
	min-width: 0;
	padding: 0 6px;
}
.sidebar-ref {
	display: flex;
	align-items: center;
	gap: 6px;
	width: 100%;
	padding: 4px 8px;
	background: none;
	border: none;
	border-radius: 6px;
	color: var(--fg);
	text-align: left;
	min-width: 0;
}
.sidebar-ref:hover {
	background: var(--surface-hover);
}
.sidebar-ref.is-current {
	background: color-mix(in srgb, var(--accent) 16%, transparent);
	color: var(--accent);
	font-weight: 600;
}
.sidebar-ref-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.sidebar-head-dot {
	flex: none;
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--added);
}
.sidebar-static {
	padding: 4px 14px;
	color: var(--muted);
}
.sidebar-static .sidebar-ref-name {
	display: block;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/sidebar/Sidebar.test.tsx`
Expected: PASS (2). Note the current-branch test targets the `main` button by role/name and checks `is-current`; the local branch button includes the head dot + name.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: sidebar with branch/remote/tag/worktree/stash listings"
```

---

### Task 6: Wire the Sidebar into Workspace + Refresh

Add the sidebar as the left column, drive the railway from ref selection, show the active ref, and add a manual Refresh.

**Files:**
- Modify: `src/workspace/Workspace.tsx`, `src/workspace/Workspace.css`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `Sidebar` (Task 5), the updated `CommitRailway` (Task 3).

- [ ] **Step 1: Update `Workspace`**

In `src/workspace/Workspace.tsx`:
- Add state `const [rev, setRev] = useState<string | null>(null)` (null = the checked-out branch).
- Add a `refreshKey` to force a refetch: `const [refreshKey, setRefreshKey] = useState(0)`.
- Render a new left column with `<Sidebar>` before the railway column; grid becomes 4 columns (sidebar | railway | detail | diff).
- On ref select: `onSelectRef={(r) => { setRev(r); setSelected(null); setDiff(""); setDiffPath(null) }}`.
- Pass `rev={rev}` to `<CommitRailway>`.
- Show the active ref in the header (e.g. next to the repo name): `rev ?? "current branch"`.
- Add a Refresh button in the header that bumps `refreshKey` (and remount Sidebar + railway by keying them on `refreshKey` together with repo path/rev). Simplest: `key={`${rev}:${refreshKey}`}` on `CommitRailway` and `key={refreshKey}` on `Sidebar` so both refetch.

Concretely:
```tsx
import { useState } from "react"
import { CommitDetail } from "../detail/CommitDetail"
import { DiffView } from "../diff/DiffView"
import { GitConsole } from "../console/GitConsole"
import { useGitConsole } from "../console/useGitConsole"
import { CommitRailway } from "../railway/CommitRailway"
import { Sidebar } from "../sidebar/Sidebar"
import type { CommitSummary, Repo } from "../ipc/bindings"
import "./Workspace.css"

export function Workspace({ repo, onBack }: { repo: Repo; onBack: () => void }) {
	const [selected, setSelected] = useState<CommitSummary | null>(null)
	const [diff, setDiff] = useState("")
	const [diffPath, setDiffPath] = useState<string | null>(null)
	const [rev, setRev] = useState<string | null>(null)
	const [refreshKey, setRefreshKey] = useState(0)
	const [consoleOpen, setConsoleOpen] = useState(false)
	const { entries, clear } = useGitConsole(500)

	function refresh() {
		setRefreshKey((k) => k + 1)
	}

	return (
		<div className="workspace">
			<header className="workspace-header">
				<button type="button" className="btn" onClick={onBack}>
					← Back
				</button>
				<h1 title={repo.name}>{repo.name}</h1>
				<span className="workspace-ref" title={rev ?? "current branch"}>
					{rev ?? "current branch"}
				</span>
				<span className="workspace-path" title={repo.path}>
					{repo.path}
				</span>
				<button type="button" className="btn workspace-refresh" onClick={refresh}>
					↻ Refresh
				</button>
			</header>
			<div className="workspace-main">
				<div className="workspace-sidebar">
					<Sidebar
						key={refreshKey}
						repoPath={repo.path}
						activeRef={rev}
						onSelectRef={(r) => {
							setRev(r)
							setSelected(null)
							setDiff("")
							setDiffPath(null)
						}}
					/>
				</div>
				<div className="workspace-railway">
					<CommitRailway
						key={`${rev ?? ""}:${refreshKey}`}
						repoPath={repo.path}
						rev={rev}
						selectedHash={selected?.hash ?? null}
						onSelect={setSelected}
					/>
				</div>
				<div className="workspace-detail">
					<CommitDetail
						repoPath={repo.path}
						selectedCommit={selected}
						onFileDiff={(d, p) => {
							setDiff(d)
							setDiffPath(p)
						}}
					/>
				</div>
				<div className="workspace-diff">
					<DiffView diff={diff} path={diffPath} />
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

- [ ] **Step 2: Update `Workspace.css`**

Change the grid to four columns and add sidebar/ref/refresh styles:
```css
.workspace-main {
	flex: 1;
	min-height: 0;
	display: grid;
	grid-template-columns: minmax(180px, 240px) minmax(300px, 1.4fr) minmax(200px, 0.8fr) minmax(340px, 2fr);
}
.workspace-sidebar,
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
.workspace-ref {
	flex: none;
	padding: 2px 8px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--accent) 16%, transparent);
	color: var(--accent);
	font-size: 12px;
}
.workspace-refresh {
	margin-left: auto;
}
```
(Keep the existing `.workspace-header` / `.workspace-path` / `.workspace-header h1` rules; the header is a flex row so `margin-left:auto` on Refresh pushes it right.)

- [ ] **Step 3: Update `App.test.tsx` mock**

`Workspace` now also calls `commands.listRefs`, `commands.listWorktrees`, `commands.listStashes` (via `Sidebar`/`useRepoRefs`). Extend the `commands` mock in `src/App.test.tsx`:
```tsx
		listRefs: vi.fn().mockResolvedValue({
			status: "ok",
			data: { local: [], remotes: [], tags: [], current: null },
		}),
		listWorktrees: vi.fn().mockResolvedValue({ status: "ok", data: [] }),
		listStashes: vi.fn().mockResolvedValue({ status: "ok", data: [] }),
```
(Add these alongside the existing `logCommits`/`gitStatus`/`listRepos`/… entries. The existing assertions — workspace heading = repo name, Back button — still hold.)

- [ ] **Step 4: Verify everything**

Run: `npx vitest run && npm run build && cargo build --manifest-path src-tauri/Cargo.toml && npm run lint`
Expected: all green. Full frontend suite includes the new Sidebar test plus all prior tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire sidebar into workspace with ref selection and refresh"
```

---

## Self-Review

**Spec coverage (M2b slice of the design spec's sidebar requirement):**
- Left sidebar with Local branches, Remote branches grouped by remote, Tags, Worktrees, Stashes → Tasks 1, 2, 4, 5 ✓
- Current branch highlighted → Task 5 (`is-current` + head dot; `current` from `list_refs`) ✓
- Browse other branches (answers the user's "where are the other branches") → Task 3 (`rev`) + Task 6 (selection drives railway) ✓
- Manual refresh (stopgap until FS-watch) → Task 6 ✓
- System git only, via `git::run` → all backend tasks ✓
- Deferred and explicitly NOT in this plan: FS-watch auto-refresh + git-console ring buffer → **M2c**; graph lane drawing → M3; checkout/stash-apply/branch create → M4 write loop. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. "Loading…", "current branch", "(detached)" are intended UI copy.

**Type consistency:** `RepoRefs`/`LocalBranch`/`RemoteBranch`/`Worktree`/`Stash` fields are snake_case in Rust and consumed as snake_case in TS (`is_head`, `is_detached`, `selector`). `log_commits` new arity `(repoPath, rev, skip, limit)` is updated consistently in the Rust command, `useCommits`, its test, `CommitRailway`, and the Workspace call. Command names `list_refs`/`listRefs`, `list_worktrees`/`listWorktrees`, `list_stashes`/`listStashes` consistent.

**Known risks flagged for execution:**
1. `log_commits` signature change ripples through `useCommits` (+ its race test), `CommitRailway`, and `Workspace`; Task 3 keeps the build green by passing `rev={null}` from Workspace immediately, and Task 6 replaces it with real state. If the test's `commands.logCommits` mock asserts arguments, it must be updated to the new arity.
2. The Sidebar test matches the `main` button by accessible name `/main/` — because the local branch button contains the head dot + name, ensure the button's accessible name still includes "main" (it does: the text node "main"). If `getByRole("button", { name: /main/ })` is ambiguous (e.g. "origin/main" also matches), scope the query to the Local section or match exactly; adjust in the test if needed.
