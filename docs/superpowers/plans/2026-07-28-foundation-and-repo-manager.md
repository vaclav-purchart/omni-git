# Foundation & Repo Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the omni-git desktop app shell — a Tauri 2 + React application where a user can add, search, remove, and open locally-checked-out git repositories, with typed Rust↔TS IPC, a git-availability check, and system/manual dark-light theming.

**Architecture:** Tauri 2 two-process app. A Rust backend owns a pure, unit-testable repo-store module (JSON persistence) and a git-availability check, exposed as typed commands via tauri-specta (generating `src/ipc/bindings.ts`). A React + TypeScript frontend renders a keyboard-driven repo launcher and an (initially empty) main workspace shell, and calls only the generated bindings. This is milestone 1 of 4 for v1; it produces a working, shippable app on its own.

**Tech Stack:** Tauri 2, Rust (stable), React 18, TypeScript 7, Vite, tauri-specta 2 + specta 2, Biome 2.5.4, Vitest + @testing-library/react (frontend tests), cargo test + tempfile + serde_json (Rust tests).

## Global Constraints

These apply to **every** task below.

- **System git only.** All git interaction shells out to the system `git` binary. Never libgit2, never a git library.
- **Frontend never touches git or the filesystem directly.** It calls only generated bindings from `src/ipc/bindings.ts`.
- **TypeScript 7.** `package.json` pins `typescript@^7`.
- **Biome 2.5.4**, config copied verbatim from `/Users/vaclav.purchart/git/duplex-commander/biome.json`: tab indentation, double quotes, semicolons `asNeeded`, trailing commas `all`. Ignore globs include `src/ipc/bindings.ts`, `src-tauri/target`, `src-tauri/gen`, `dist`, `docs`, `PROMPT.md`.
- **`src/ipc/bindings.ts` is generated** by tauri-specta — never hand-edit it, and it is git-ignored / biome-ignored.
- **Cross-platform.** No macOS-only paths or APIs in backend logic; use Tauri path APIs and Rust `dirs`/`std` cross-platform primitives.
- **Frequent commits.** Each task ends by committing.
- **Author identity for commits in this repo:** `Vaclav Purchart <vaclav.purchart@finshape.com>` (the repo has no configured user yet; pass `-c user.name=... -c user.email=...` if a commit fails for missing identity).

---

### Task 1: Scaffold the Tauri 2 + React + TS7 project

Stands up the buildable project skeleton: Tauri 2 Rust backend, React + Vite frontend, TypeScript 7, and the Biome config. Deliverable: `npm run tauri dev` launches an empty window; `npm run build` and `cargo build` both succeed.

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `biome.json`
- Create: `src/main.tsx`, `src/App.tsx`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
- Create: `.gitignore` (already exists — verify entries)

**Interfaces:**
- Produces: a runnable Tauri app named `omni-git`; frontend entry `src/main.tsx`; Rust entry `src-tauri/src/lib.rs` exposing `run()`.

- [ ] **Step 1: Create the project with the Tauri CLI**

Run (non-interactive; answers: React, TypeScript, npm):
```bash
npm create tauri-app@latest omni-git-scaffold -- --template react-ts --manager npm
```
Then move its generated files into the current repo root (the repo already contains `PROMPT.md`, `source-tree.png`, `docs/`, `.gitignore`). Do **not** overwrite the existing `.gitignore`, `docs/`, `PROMPT.md`. Copy in: `src/`, `src-tauri/`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig*.json`. Then delete the temporary `omni-git-scaffold` directory.

- [ ] **Step 2: Pin TypeScript 7 and add Biome**

Edit `package.json`: set `"typescript": "^7.0.0"` in devDependencies, and add scripts:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri",
    "lint": "biome check .",
    "format": "biome format --write .",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Copy the Biome config verbatim**

Copy `/Users/vaclav.purchart/git/duplex-commander/biome.json` to `./biome.json` unchanged. It already ignores `src/ipc/bindings.ts`, `src-tauri/target`, `src-tauri/gen`, `dist`, `docs`, `PROMPT.md`.

- [ ] **Step 4: Set app identity**

In `src-tauri/tauri.conf.json` set `"productName": "omni-git"`, `"identifier": "dev.finshape.omni-git"`, window `"title": "omni-git"`. In `src-tauri/Cargo.toml` set `name = "omni-git"`.

- [ ] **Step 5: Verify it builds and runs**

Run:
```bash
npm install
npm run build
cargo build --manifest-path src-tauri/Cargo.toml
```
Expected: both succeed with no errors. (A manual `npm run tauri dev` should open an empty window; not required in CI.)

- [ ] **Step 6: Verify Biome is clean**

Run: `npm run lint`
Expected: no errors (fix formatting with `npm run format` if needed).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri 2 + React + TS7 project with Biome"
```

---

### Task 2: Wire up tauri-specta typed IPC bindings

Establish the typed Rust↔TS command pipeline so every later command auto-generates into `src/ipc/bindings.ts`. Prove it end-to-end with a trivial `ping` command called from React.

**Files:**
- Modify: `src-tauri/Cargo.toml` (add deps)
- Modify: `src-tauri/src/lib.rs` (Builder + command registration + export)
- Create: `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/misc.rs`
- Create (generated, git-ignored): `src/ipc/bindings.ts`
- Modify: `src/App.tsx` (call the binding)
- Modify: `.gitignore` (add `src/ipc/bindings.ts`)

**Interfaces:**
- Produces: `#[tauri::command] #[specta::specta] fn ping() -> String` returning `"pong"`; generated TS `commands.ping(): Promise<string>`; a `Builder` in `lib.rs` that all later tasks register commands on.

- [ ] **Step 1: Add dependencies**

In `src-tauri/Cargo.toml` `[dependencies]`:
```toml
tauri = { version = "2", features = [] }
tauri-specta = { version = "=2.0.0-rc.21", features = ["derive", "typescript"] }
specta = { version = "=2.0.0-rc.22", features = [] }
specta-typescript = "0.0.9"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```
(If exact rc versions are unavailable, use the latest compatible tauri-specta 2 release and adjust the API calls in Step 3 to match its docs.)

- [ ] **Step 2: Create the commands module**

Create `src-tauri/src/commands/mod.rs`:
```rust
pub mod misc;
```
Create `src-tauri/src/commands/misc.rs`:
```rust
#[tauri::command]
#[specta::specta]
pub fn ping() -> String {
    "pong".to_string()
}
```

- [ ] **Step 3: Build the specta Builder and export bindings in `lib.rs`**

Replace `src-tauri/src/lib.rs` with:
```rust
mod commands;

use tauri_specta::{collect_commands, Builder};

pub fn run() {
    let builder = Builder::<tauri::Wry>::new().commands(collect_commands![commands::misc::ping]);

    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/ipc/bindings.ts",
        )
        .expect("failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running omni-git");
}
```
(Keep the `tauri_plugin_opener` line only if the scaffold added it; otherwise remove that `.plugin(...)` call.)

- [ ] **Step 4: Generate bindings and call from React**

Run `cargo build --manifest-path src-tauri/Cargo.toml` then `npm run tauri dev` once to generate `src/ipc/bindings.ts` (debug export runs on app start). Then in `src/App.tsx`, import and call:
```tsx
import { useEffect, useState } from "react"
import { commands } from "./ipc/bindings"

export default function App() {
	const [pong, setPong] = useState("")
	useEffect(() => {
		commands.ping().then(setPong)
	}, [])
	return <main>{pong}</main>
}
```

- [ ] **Step 5: Verify bindings exist and typecheck**

Run: `npm run build`
Expected: PASS — `src/ipc/bindings.ts` exists and `commands.ping` typechecks as `() => Promise<string>`.

- [ ] **Step 6: Ignore generated bindings**

Add `src/ipc/bindings.ts` to `.gitignore` (Biome already ignores it).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: typed Rust<->TS IPC via tauri-specta with ping command"
```

---

### Task 3: Git availability check

A backend command that runs `git --version` and reports whether system git is present and its version, surfaced to the frontend on startup.

**Files:**
- Create: `src-tauri/src/git/mod.rs`, `src-tauri/src/git/availability.rs`
- Modify: `src-tauri/src/lib.rs` (declare `mod git;`, register command)
- Modify: `src-tauri/src/commands/misc.rs` (expose command)

**Interfaces:**
- Consumes: none.
- Produces: `pub struct GitStatus { pub available: bool, pub version: Option<String> }` (Serialize + specta::Type); `fn check_git() -> GitStatus`; command `git_status() -> GitStatus`; generated `commands.gitStatus(): Promise<GitStatus>`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/git/availability.rs`:
```rust
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct GitStatus {
	pub available: bool,
	pub version: Option<String>,
}

/// Runs `git --version`. `available` is true only on a zero exit with parseable output.
pub fn check_git() -> GitStatus {
	match Command::new("git").arg("--version").output() {
		Ok(out) if out.status.success() => {
			let version = String::from_utf8_lossy(&out.stdout)
				.trim()
				.strip_prefix("git version ")
				.map(|s| s.to_string());
			GitStatus { available: version.is_some(), version }
		}
		_ => GitStatus { available: false, version: None },
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn detects_system_git() {
		// CI and dev machines have git installed.
		let status = check_git();
		assert!(status.available, "expected system git to be available");
		assert!(status.version.is_some());
	}
}
```
Create `src-tauri/src/git/mod.rs`:
```rust
pub mod availability;
```

- [ ] **Step 2: Run the test to verify it passes (git is installed)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml git::availability`
Expected: PASS (this environment has git). If it fails because git is missing, that is a real environment problem, not a code problem.

- [ ] **Step 3: Expose the command**

In `src-tauri/src/commands/misc.rs` add:
```rust
use crate::git::availability::{check_git, GitStatus};

#[tauri::command]
#[specta::specta]
pub fn git_status() -> GitStatus {
	check_git()
}
```
In `src-tauri/src/lib.rs`: add `mod git;` and add `commands::misc::git_status` to `collect_commands![...]`.

- [ ] **Step 4: Regenerate bindings and typecheck**

Run: `cargo build --manifest-path src-tauri/Cargo.toml && npm run tauri dev` (once, to regenerate `bindings.ts`), then `npm run build`.
Expected: `commands.gitStatus` typechecks; `GitStatus` type is exported.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: git availability check command"
```

---

### Task 4: Repo store — pure Rust persistence module

A pure, Tauri-free module that manages the list of added repositories, persisted as JSON. Fully unit-testable against a temp path. This is the core data model for the repo manager.

**Files:**
- Create: `src-tauri/src/store/mod.rs`, `src-tauri/src/store/repos.rs`
- Modify: `src-tauri/Cargo.toml` (add `tempfile` dev-dependency, `uuid`)
- Modify: `src-tauri/src/lib.rs` (declare `mod store;`)

**Interfaces:**
- Consumes: none.
- Produces:
  - `pub struct Repo { pub id: String, pub name: String, pub path: String }` (Serialize/Deserialize/Clone + specta::Type)
  - `pub struct RepoStore { path: PathBuf }`
  - `RepoStore::new(path: PathBuf) -> Self`
  - `RepoStore::list(&self) -> Vec<Repo>`
  - `RepoStore::add(&self, path: &str) -> Result<Repo, StoreError>` (validates the path is a git repo dir; derives `name` from the dir; rejects duplicates by canonical path; assigns a uuid `id`)
  - `RepoStore::remove(&self, id: &str) -> Result<(), StoreError>`
  - `pub enum StoreError { NotAGitRepo, Duplicate, NotFound, Io(String) }` (Serialize + specta::Type)

- [ ] **Step 1: Add dependencies**

In `src-tauri/Cargo.toml`:
```toml
[dependencies]
uuid = { version = "1", features = ["v4"] }

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/store/repos.rs`:
```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Repo {
	pub id: String,
	pub name: String,
	pub path: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "message")]
pub enum StoreError {
	NotAGitRepo,
	Duplicate,
	NotFound,
	Io(String),
}

pub struct RepoStore {
	path: PathBuf,
}

impl RepoStore {
	pub fn new(path: PathBuf) -> Self {
		Self { path }
	}

	pub fn list(&self) -> Vec<Repo> {
		match std::fs::read_to_string(&self.path) {
			Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
			Err(_) => Vec::new(),
		}
	}

	fn write(&self, repos: &[Repo]) -> Result<(), StoreError> {
		let json = serde_json::to_string_pretty(repos).map_err(|e| StoreError::Io(e.to_string()))?;
		if let Some(parent) = self.path.parent() {
			std::fs::create_dir_all(parent).map_err(|e| StoreError::Io(e.to_string()))?;
		}
		std::fs::write(&self.path, json).map_err(|e| StoreError::Io(e.to_string()))
	}

	pub fn add(&self, repo_path: &str) -> Result<Repo, StoreError> {
		let p = Path::new(repo_path);
		if !p.join(".git").exists() {
			return Err(StoreError::NotAGitRepo);
		}
		let canonical = std::fs::canonicalize(p)
			.map_err(|e| StoreError::Io(e.to_string()))?
			.to_string_lossy()
			.to_string();
		let mut repos = self.list();
		if repos.iter().any(|r| r.path == canonical) {
			return Err(StoreError::Duplicate);
		}
		let name = p
			.file_name()
			.map(|n| n.to_string_lossy().to_string())
			.unwrap_or_else(|| canonical.clone());
		let repo = Repo {
			id: uuid::Uuid::new_v4().to_string(),
			name,
			path: canonical,
		};
		repos.push(repo.clone());
		self.write(&repos)?;
		Ok(repo)
	}

	pub fn remove(&self, id: &str) -> Result<(), StoreError> {
		let mut repos = self.list();
		let before = repos.len();
		repos.retain(|r| r.id != id);
		if repos.len() == before {
			return Err(StoreError::NotFound);
		}
		self.write(&repos)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;

	fn temp_git_repo() -> tempfile::TempDir {
		let dir = tempfile::tempdir().unwrap();
		Command::new("git")
			.arg("init")
			.arg(dir.path())
			.output()
			.unwrap();
		dir
	}

	fn store_in(dir: &Path) -> RepoStore {
		RepoStore::new(dir.join("repos.json"))
	}

	#[test]
	fn add_lists_and_removes_a_repo() {
		let cfg = tempfile::tempdir().unwrap();
		let store = store_in(cfg.path());
		let repo_dir = temp_git_repo();

		let added = store.add(repo_dir.path().to_str().unwrap()).unwrap();
		assert_eq!(store.list().len(), 1);
		assert!(!added.name.is_empty());

		store.remove(&added.id).unwrap();
		assert_eq!(store.list().len(), 0);
	}

	#[test]
	fn rejects_non_git_dir() {
		let cfg = tempfile::tempdir().unwrap();
		let store = store_in(cfg.path());
		let plain = tempfile::tempdir().unwrap();
		assert!(matches!(
			store.add(plain.path().to_str().unwrap()),
			Err(StoreError::NotAGitRepo)
		));
	}

	#[test]
	fn rejects_duplicate() {
		let cfg = tempfile::tempdir().unwrap();
		let store = store_in(cfg.path());
		let repo_dir = temp_git_repo();
		store.add(repo_dir.path().to_str().unwrap()).unwrap();
		assert!(matches!(
			store.add(repo_dir.path().to_str().unwrap()),
			Err(StoreError::Duplicate)
		));
	}

	#[test]
	fn remove_missing_is_not_found() {
		let cfg = tempfile::tempdir().unwrap();
		let store = store_in(cfg.path());
		assert!(matches!(store.remove("nope"), Err(StoreError::NotFound)));
	}
}
```
Create `src-tauri/src/store/mod.rs`:
```rust
pub mod repos;
```
Add `mod store;` to `src-tauri/src/lib.rs`.

- [ ] **Step 3: Run tests to verify they fail, then pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml store::`
Expected: the module compiles and all four tests PASS. (Implementation is included above; if a test fails, fix the implementation until green.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: repo store persistence module with tests"
```

---

### Task 5: Repo store IPC commands

Expose the repo store to the frontend as typed commands, backed by a real config-dir path resolved via Tauri.

**Files:**
- Create: `src-tauri/src/commands/repos.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod repos;`)
- Modify: `src-tauri/src/lib.rs` (register commands, manage store path)

**Interfaces:**
- Consumes: `store::repos::{Repo, RepoStore, StoreError}` (Task 4).
- Produces commands (all `Result<T, StoreError>` where fallible):
  - `list_repos() -> Vec<Repo>`
  - `add_repo(path: String) -> Result<Repo, StoreError>`
  - `remove_repo(id: String) -> Result<(), StoreError>`
- Generated TS: `commands.listRepos()`, `commands.addRepo(path)`, `commands.removeRepo(id)`.

- [ ] **Step 1: Resolve the store path helper**

Create `src-tauri/src/commands/repos.rs`:
```rust
use crate::store::repos::{Repo, RepoStore, StoreError};
use tauri::Manager;

fn store(app: &tauri::AppHandle) -> Result<RepoStore, StoreError> {
	let dir = app
		.path()
		.app_config_dir()
		.map_err(|e| StoreError::Io(e.to_string()))?;
	Ok(RepoStore::new(dir.join("repos.json")))
}

#[tauri::command]
#[specta::specta]
pub fn list_repos(app: tauri::AppHandle) -> Result<Vec<Repo>, StoreError> {
	Ok(store(&app)?.list())
}

#[tauri::command]
#[specta::specta]
pub fn add_repo(app: tauri::AppHandle, path: String) -> Result<Repo, StoreError> {
	store(&app)?.add(&path)
}

#[tauri::command]
#[specta::specta]
pub fn remove_repo(app: tauri::AppHandle, id: String) -> Result<(), StoreError> {
	store(&app)?.remove(&id)
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/commands/mod.rs` add `pub mod repos;`. In `src-tauri/src/lib.rs`, add to `collect_commands![...]`: `commands::repos::list_repos, commands::repos::add_repo, commands::repos::remove_repo`.

- [ ] **Step 3: Regenerate bindings, typecheck**

Run: `cargo build --manifest-path src-tauri/Cargo.toml && npm run tauri dev` (once), then `npm run build`.
Expected: `commands.listRepos`, `commands.addRepo`, `commands.removeRepo` present and typed; `StoreError` union exported.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: repo store IPC commands"
```

---

### Task 6: Repo store frontend hook + fuzzy search

A React hook wrapping the repo bindings, plus a pure, tested client-side filter for the launcher search box.

**Files:**
- Create: `src/repos/useRepos.ts`
- Create: `src/repos/filterRepos.ts`
- Create: `src/repos/filterRepos.test.ts`
- Create: `vitest.config.ts` (if not present), `src/test-setup.ts`
- Modify: `package.json` (add `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `vitest` devDeps)

**Interfaces:**
- Consumes: `commands` from `src/ipc/bindings.ts` (Task 5); `Repo` type from bindings.
- Produces:
  - `filterRepos(repos: Repo[], query: string): Repo[]` — case-insensitive substring match on `name` then `path`, preserving input order, returning all when query is empty/whitespace.
  - `useRepos()` returning `{ repos, loading, add(path), remove(id), reload() }`.

- [ ] **Step 1: Add test deps and Vitest config**

In `package.json` devDependencies add: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@testing-library/user-event`. Create `vitest.config.ts`:
```ts
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/test-setup.ts"],
	},
})
```
Create `src/test-setup.ts`:
```ts
import "@testing-library/jest-dom/vitest"
```
Run `npm install`.

- [ ] **Step 2: Write the failing test for `filterRepos`**

Create `src/repos/filterRepos.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { filterRepos } from "./filterRepos"

const repos = [
	{ id: "1", name: "configurator", path: "/code/configurator" },
	{ id: "2", name: "omni-git", path: "/code/omni-git" },
	{ id: "3", name: "duplex", path: "/work/duplex-commander" },
]

describe("filterRepos", () => {
	it("returns all repos for an empty query", () => {
		expect(filterRepos(repos, "")).toHaveLength(3)
		expect(filterRepos(repos, "   ")).toHaveLength(3)
	})

	it("matches on name case-insensitively", () => {
		expect(filterRepos(repos, "OMNI").map((r) => r.id)).toEqual(["2"])
	})

	it("matches on path when name does not match", () => {
		expect(filterRepos(repos, "work").map((r) => r.id)).toEqual(["3"])
	})

	it("preserves input order", () => {
		expect(filterRepos(repos, "c").map((r) => r.id)).toEqual(["1", "3"])
	})
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/repos/filterRepos.test.ts`
Expected: FAIL — "Cannot find module './filterRepos'".

- [ ] **Step 4: Implement `filterRepos`**

Create `src/repos/filterRepos.ts`:
```ts
import type { Repo } from "../ipc/bindings"

export function filterRepos(repos: Repo[], query: string): Repo[] {
	const q = query.trim().toLowerCase()
	if (q === "") {
		return repos
	}
	return repos.filter(
		(r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
	)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/repos/filterRepos.test.ts`
Expected: PASS (all 4).

- [ ] **Step 6: Implement the `useRepos` hook**

Create `src/repos/useRepos.ts`:
```ts
import { useCallback, useEffect, useState } from "react"
import { commands, type Repo } from "../ipc/bindings"

export function useRepos() {
	const [repos, setRepos] = useState<Repo[]>([])
	const [loading, setLoading] = useState(true)

	const reload = useCallback(async () => {
		setLoading(true)
		const result = await commands.listRepos()
		if (result.status === "ok") {
			setRepos(result.data)
		}
		setLoading(false)
	}, [])

	useEffect(() => {
		reload()
	}, [reload])

	const add = useCallback(
		async (path: string) => {
			const result = await commands.addRepo(path)
			await reload()
			return result
		},
		[reload],
	)

	const remove = useCallback(
		async (id: string) => {
			await commands.removeRepo(id)
			await reload()
		},
		[reload],
	)

	return { repos, loading, add, remove, reload }
}
```
(Note: tauri-specta wraps `Result` commands as `{ status: "ok", data } | { status: "error", error }`. If the generated shape differs in your version, adapt the `result.status` checks to match `bindings.ts`.)

- [ ] **Step 7: Verify build + tests**

Run: `npm run build && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: repo store frontend hook and tested search filter"
```

---

### Task 7: Repo launcher UI with keyboard behavior

The launch screen: a searchable list of repos. Search auto-focused on mount; **Enter** opens the first result; **Esc** clears the query but keeps focus; each row has a remove action; an "Add repository" button opens a native folder picker.

**Files:**
- Create: `src/launcher/RepoLauncher.tsx`
- Create: `src/launcher/RepoLauncher.test.tsx`
- Create: `src/launcher/RepoLauncher.css`
- Modify: `package.json` / `src-tauri/Cargo.toml` — add the Tauri dialog plugin
- Modify: `src-tauri/src/lib.rs` — register dialog plugin

**Interfaces:**
- Consumes: `useRepos` (Task 6), `filterRepos` (Task 6), `Repo` type.
- Produces: `<RepoLauncher onOpen={(repo: Repo) => void} />` — parent supplies the open handler (App wires it in Task 9).

- [ ] **Step 1: Add the dialog plugin (native folder picker)**

In `src-tauri/Cargo.toml`: `tauri-plugin-dialog = "2"`. In `src-tauri/src/lib.rs` add `.plugin(tauri_plugin_dialog::init())`. In `package.json`: `@tauri-apps/plugin-dialog`. Run `npm install` and `cargo build --manifest-path src-tauri/Cargo.toml`.

- [ ] **Step 2: Write the failing component test**

Create `src/launcher/RepoLauncher.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { RepoLauncher } from "./RepoLauncher"

const repos = [
	{ id: "1", name: "configurator", path: "/code/configurator" },
	{ id: "2", name: "omni-git", path: "/code/omni-git" },
]

vi.mock("../repos/useRepos", () => ({
	useRepos: () => ({
		repos,
		loading: false,
		add: vi.fn(),
		remove: vi.fn(),
		reload: vi.fn(),
	}),
}))

describe("RepoLauncher", () => {
	it("auto-focuses the search box on mount", () => {
		render(<RepoLauncher onOpen={vi.fn()} />)
		expect(screen.getByPlaceholderText(/search/i)).toHaveFocus()
	})

	it("opens the first filtered result on Enter", async () => {
		const onOpen = vi.fn()
		render(<RepoLauncher onOpen={onOpen} />)
		await userEvent.keyboard("omni")
		await userEvent.keyboard("{Enter}")
		expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }))
	})

	it("clears the query but keeps focus on Escape", async () => {
		render(<RepoLauncher onOpen={vi.fn()} />)
		const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement
		await userEvent.keyboard("omni")
		expect(input.value).toBe("omni")
		await userEvent.keyboard("{Escape}")
		expect(input.value).toBe("")
		expect(input).toHaveFocus()
	})
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/launcher/RepoLauncher.test.tsx`
Expected: FAIL — cannot find `./RepoLauncher`.

- [ ] **Step 4: Implement the component**

Create `src/launcher/RepoLauncher.tsx`:
```tsx
import { useMemo, useRef, useState } from "react"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import type { Repo } from "../ipc/bindings"
import { filterRepos } from "../repos/filterRepos"
import { useRepos } from "../repos/useRepos"
import "./RepoLauncher.css"

export function RepoLauncher({ onOpen }: { onOpen: (repo: Repo) => void }) {
	const { repos, add, remove } = useRepos()
	const [query, setQuery] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)

	const filtered = useMemo(() => filterRepos(repos, query), [repos, query])

	function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter" && filtered.length > 0) {
			onOpen(filtered[0])
		} else if (e.key === "Escape") {
			e.preventDefault()
			setQuery("")
			inputRef.current?.focus()
		}
	}

	async function onAdd() {
		const picked = await openDialog({ directory: true, multiple: false })
		if (typeof picked === "string") {
			await add(picked)
		}
	}

	return (
		<div className="launcher">
			<div className="launcher-bar">
				<input
					ref={inputRef}
					className="launcher-search"
					placeholder="Search repositories…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={onKeyDown}
					// biome-ignore lint/a11y/noAutofocus: launcher spec requires focus on mount
					autoFocus
				/>
				<button type="button" onClick={onAdd}>
					Add repository
				</button>
			</div>
			<ul className="launcher-list">
				{filtered.map((repo) => (
					<li key={repo.id} className="launcher-item">
						<button type="button" className="launcher-open" onClick={() => onOpen(repo)}>
							<span className="launcher-name">{repo.name}</span>
							<span className="launcher-path">{repo.path}</span>
						</button>
						<button
							type="button"
							className="launcher-remove"
							title="Remove from list (does not delete on disk)"
							onClick={() => remove(repo.id)}
						>
							✕
						</button>
					</li>
				))}
			</ul>
		</div>
	)
}
```
Create `src/launcher/RepoLauncher.css` with minimal layout:
```css
.launcher {
	display: flex;
	flex-direction: column;
	height: 100vh;
	padding: 16px;
	gap: 12px;
}
.launcher-bar {
	display: flex;
	gap: 8px;
}
.launcher-search {
	flex: 1;
	padding: 8px 12px;
	font-size: 15px;
}
.launcher-list {
	list-style: none;
	margin: 0;
	padding: 0;
	overflow-y: auto;
}
.launcher-item {
	display: flex;
	align-items: center;
}
.launcher-open {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	padding: 8px 12px;
	background: none;
	border: none;
	text-align: left;
	cursor: pointer;
}
.launcher-path {
	opacity: 0.6;
	font-size: 12px;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/launcher/RepoLauncher.test.tsx`
Expected: PASS (all 3).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add -A
git commit -m "feat: repo launcher with keyboard-driven search"
```

---

### Task 8: Theming — system detection and manual override

Dark/light theme that defaults to the system preference and can be manually overridden, persisted across launches.

**Files:**
- Create: `src/theme/useTheme.ts`
- Create: `src/theme/useTheme.test.ts`
- Create: `src/theme/theme.css`
- Modify: `src/main.tsx` (import `theme.css`)

**Interfaces:**
- Consumes: none (uses `window.matchMedia`, `localStorage`).
- Produces:
  - `type ThemePref = "system" | "light" | "dark"`
  - `resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark"` (pure)
  - `useTheme()` returning `{ pref, resolved, setPref(p) }` — applies `data-theme` to `document.documentElement` and persists `pref` to `localStorage` under key `omni-git.theme`.

- [ ] **Step 1: Write the failing test for `resolveTheme`**

Create `src/theme/useTheme.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { resolveTheme } from "./useTheme"

describe("resolveTheme", () => {
	it("follows system when pref is system", () => {
		expect(resolveTheme("system", true)).toBe("dark")
		expect(resolveTheme("system", false)).toBe("light")
	})

	it("honors explicit overrides regardless of system", () => {
		expect(resolveTheme("light", true)).toBe("light")
		expect(resolveTheme("dark", false)).toBe("dark")
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/theme/useTheme.test.ts`
Expected: FAIL — cannot find `./useTheme`.

- [ ] **Step 3: Implement `useTheme`**

Create `src/theme/useTheme.ts`:
```ts
import { useCallback, useEffect, useState } from "react"

export type ThemePref = "system" | "light" | "dark"
const STORAGE_KEY = "omni-git.theme"

export function resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark" {
	if (pref === "system") {
		return systemDark ? "dark" : "light"
	}
	return pref
}

function loadPref(): ThemePref {
	const stored = localStorage.getItem(STORAGE_KEY)
	return stored === "light" || stored === "dark" || stored === "system" ? stored : "system"
}

export function useTheme() {
	const [pref, setPrefState] = useState<ThemePref>(loadPref)
	const [systemDark, setSystemDark] = useState(
		() => window.matchMedia("(prefers-color-scheme: dark)").matches,
	)

	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)")
		const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
		mq.addEventListener("change", onChange)
		return () => mq.removeEventListener("change", onChange)
	}, [])

	const resolved = resolveTheme(pref, systemDark)

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", resolved)
	}, [resolved])

	const setPref = useCallback((p: ThemePref) => {
		localStorage.setItem(STORAGE_KEY, p)
		setPrefState(p)
	}, [])

	return { pref, resolved, setPref }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/theme/useTheme.test.ts`
Expected: PASS.

- [ ] **Step 5: Add theme CSS variables**

Create `src/theme/theme.css`:
```css
:root,
:root[data-theme="light"] {
	--bg: #ffffff;
	--fg: #1a1a1a;
	--muted: #6b7280;
	--border: #e5e7eb;
	--accent: #2563eb;
}
:root[data-theme="dark"] {
	--bg: #1e1e1e;
	--fg: #e5e7eb;
	--muted: #9ca3af;
	--border: #333333;
	--accent: #60a5fa;
}
body {
	background: var(--bg);
	color: var(--fg);
	margin: 0;
	font-family: system-ui, sans-serif;
}
```
Import it at the top of `src/main.tsx`: `import "./theme/theme.css"`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: system + manual dark/light theming"
```

---

### Task 9: App shell — wire launcher, workspace placeholder, theme toggle

Assemble the pieces: App shows the launcher; opening a repo switches to a workspace placeholder (the real workspace is Plan 2) with a back action and a theme toggle. Verifies the whole milestone runs end-to-end.

**Files:**
- Modify: `src/App.tsx`
- Create: `src/workspace/WorkspacePlaceholder.tsx`
- Create: `src/App.test.tsx`
- Create: `src/App.css`

**Interfaces:**
- Consumes: `RepoLauncher` (Task 7), `useTheme` (Task 8), `commands.gitStatus` (Task 3), `Repo` type.
- Produces: top-level `<App />` managing `selectedRepo: Repo | null` and rendering launcher vs workspace.

- [ ] **Step 1: Write the failing test**

Create `src/App.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import App from "./App"

vi.mock("./ipc/bindings", () => ({
	commands: {
		gitStatus: vi.fn().mockResolvedValue({ available: true, version: "2.44.0" }),
		listRepos: vi.fn().mockResolvedValue({ status: "ok", data: [
			{ id: "1", name: "omni-git", path: "/code/omni-git" },
		] }),
		addRepo: vi.fn(),
		removeRepo: vi.fn(),
	},
}))

describe("App", () => {
	it("shows the launcher, then the workspace after opening a repo", async () => {
		render(<App />)
		const input = await screen.findByPlaceholderText(/search/i)
		await userEvent.type(input, "omni")
		await userEvent.keyboard("{Enter}")
		expect(await screen.findByText(/omni-git/i)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL (App still renders the ping placeholder).

- [ ] **Step 3: Implement the workspace placeholder**

Create `src/workspace/WorkspacePlaceholder.tsx`:
```tsx
import type { Repo } from "../ipc/bindings"

export function WorkspacePlaceholder({ repo, onBack }: { repo: Repo; onBack: () => void }) {
	return (
		<div className="workspace">
			<header className="workspace-header">
				<button type="button" onClick={onBack}>
					← Back
				</button>
				<h1>{repo.name}</h1>
				<span className="workspace-path">{repo.path}</span>
			</header>
			<p>Repository view coming in the next milestone.</p>
		</div>
	)
}
```

- [ ] **Step 4: Implement App**

Replace `src/App.tsx`:
```tsx
import { useEffect, useState } from "react"
import "./App.css"
import { commands, type Repo } from "./ipc/bindings"
import { RepoLauncher } from "./launcher/RepoLauncher"
import { useTheme } from "./theme/useTheme"
import { WorkspacePlaceholder } from "./workspace/WorkspacePlaceholder"

export default function App() {
	const [selected, setSelected] = useState<Repo | null>(null)
	const [gitOk, setGitOk] = useState(true)
	const { pref, setPref } = useTheme()

	useEffect(() => {
		commands.gitStatus().then((s) => setGitOk(s.available))
	}, [])

	return (
		<div className="app">
			<div className="app-topbar">
				<button
					type="button"
					title="Toggle theme"
					onClick={() => setPref(pref === "dark" ? "light" : "dark")}
				>
					{pref === "dark" ? "🌙" : "☀️"}
				</button>
			</div>
			{!gitOk && (
				<div className="app-warning">
					System git was not found. Install git and restart omni-git.
				</div>
			)}
			{selected ? (
				<WorkspacePlaceholder repo={selected} onBack={() => setSelected(null)} />
			) : (
				<RepoLauncher onOpen={setSelected} />
			)}
		</div>
	)
}
```
Create `src/App.css`:
```css
.app {
	height: 100vh;
	display: flex;
	flex-direction: column;
}
.app-topbar {
	display: flex;
	justify-content: flex-end;
	padding: 4px 8px;
	border-bottom: 1px solid var(--border);
}
.app-warning {
	background: #b91c1c;
	color: white;
	padding: 8px 12px;
}
.workspace {
	padding: 16px;
}
.workspace-header {
	display: flex;
	align-items: baseline;
	gap: 12px;
}
.workspace-path {
	opacity: 0.6;
	font-size: 12px;
}
```

- [ ] **Step 5: Run the test and full suite**

Run: `npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 6: Manual smoke test**

Run `npm run tauri dev`. Verify: launcher opens with search focused; adding a real git repo lists it; typing filters; Enter opens the first; the theme toggle flips colors; Back returns to the launcher. Fix anything that misbehaves.

- [ ] **Step 7: Final lint + commit**

```bash
npm run lint
git add -A
git commit -m "feat: app shell wiring launcher, workspace placeholder, theme toggle"
```

---

## Self-Review

**Spec coverage (Plan 1 slice of the v1 spec):**
- Repo manager add/remove/search/launch → Tasks 4–7, 9 ✓
- Launcher keyboard behavior (autofocus, Enter opens first, Esc clears + keeps focus) → Task 7 tests ✓
- Remove is store-only, no disk changes → Task 4 (`remove` only edits JSON) ✓
- Use system git + verify configured → Task 3 ✓
- Typed IPC via tauri-specta → Task 2, generating `src/ipc/bindings.ts` ✓
- Dark/light theme, system + manual → Task 8 ✓
- Biome config verbatim, TS7, tab indent → Task 1 + Global Constraints ✓
- Near-zero idle / no polling → nothing in Plan 1 introduces a timer; FS-watch is Plan 2 ✓
- Sidebar listings, commit railway, diff, staging, push/pull, git console, graph → **deliberately deferred to Plans 2–4** (noted in header). ✓

**Placeholder scan:** No TBD/TODO left in steps; every code step includes complete code. The `WorkspacePlaceholder` "coming in the next milestone" text is intended user-facing copy for this milestone, not a plan placeholder. ✓

**Type consistency:** `Repo { id, name, path }` used identically in Rust (Task 4) and TS (Tasks 6–9). `StoreError` variants match between Rust definition and the `result.status`-based handling note. Command names (`list_repos`/`listRepos`, `add_repo`/`addRepo`, `remove_repo`/`removeRepo`, `git_status`/`gitStatus`, `ping`) are consistent across tasks. `ThemePref`, `resolveTheme`, `useTheme` names consistent (Task 8). ✓

**Known version risk:** tauri-specta 2 is pre-1.0; exact rc versions and the generated `Result` wrapper shape may drift. Tasks 2 and 6 flag this and tell the implementer to adapt to the installed version's `bindings.ts`. This is the one place to watch during execution.
