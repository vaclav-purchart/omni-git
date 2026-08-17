use crate::git::run::run;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::{RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, FileIdMap};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

/// How long to coalesce a burst of filesystem events before reloading.
const DEBOUNCE: Duration = Duration::from_millis(400);

/// How often the debouncer's thread wakes to check whether the debounce window
/// has elapsed. Passed EXPLICITLY: given `None` the crate picks `timeout / 4`
/// (100ms here), so a thread wakes ten times a second forever even when nothing
/// is happening — measurable idle cost for no benefit. Equal to the timeout gives
/// 2.5 wakeups a second; the cost is up to one extra debounce window of latency
/// before a reload, which is not noticeable.
///
/// The crate rejects a tick LARGER than the timeout, so these must stay in this
/// relationship — see the test below.
const TICK: Duration = DEBOUNCE;
use tauri::Manager;
use tauri_specta::Event;

/// Emitted whenever the watched repo's `.git` directory changes on disk
/// (commit, checkout, branch op, fetch, merge, stash, staging, ...). Empty
/// payload: the frontend re-queries whatever it needs on receipt.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct RepoChanged {}

type Deb = Debouncer<notify::RecommendedWatcher, FileIdMap>;

/// Managed state holding the single active debouncer. Storing it keeps the
/// watcher alive — dropping the `Debouncer` stops the watch immediately.
#[derive(Default)]
pub struct RepoWatcher(pub Mutex<Option<Deb>>);

/// Resolve the actual git dir (handles linked worktrees where `.git` is a
/// file). Returns `None` if resolution fails or the path doesn't exist, so
/// callers can silently do nothing rather than panic.
fn git_dir(app: &tauri::AppHandle, repo_path: &str) -> Option<PathBuf> {
    run(app, repo_path, &["rev-parse", "--absolute-git-dir"])
        .ok()
        .map(|s| PathBuf::from(s.trim()))
        .filter(|p| p.exists())
}

/// Builds a matcher from the repo's root `.gitignore` and `.git/info/exclude`.
///
/// Only those two: nested per-directory `.gitignore` files are NOT consulted, so
/// churn under an ignore rule declared deeper in the tree can still wake us. That
/// costs a redundant reload (invisible, since panels reload in place) rather than
/// anything incorrect, and the root file is what covers the cases that actually
/// matter — `node_modules/`, `target/`, `dist/`.
fn build_ignore(root: &Path) -> Option<Gitignore> {
    let mut builder = GitignoreBuilder::new(root);
    let _ = builder.add(root.join(".gitignore"));
    let _ = builder.add(root.join(".git").join("info").join("exclude"));
    builder.build().ok()
}

/// Whether a changed path should wake the UI.
///
/// Anything inside the git dir always counts — that IS repo state. Everything
/// else is dropped if git would ignore it, which is what keeps a `yarn install`
/// or a cargo build from triggering a reload every 400ms.
fn is_relevant(path: &Path, git_dir: &Path, ignore: Option<&Gitignore>) -> bool {
    if path.starts_with(git_dir) {
        return true;
    }
    match ignore {
        // `is_dir()` is false for a path that has just been deleted, which is the
        // conservative answer here: it can only make us MORE likely to reload.
        Some(ig) => !ig
            .matched_path_or_any_parents(path, path.is_dir())
            .is_ignore(),
        None => true,
    }
}

/// Start watching the repo: the resolved `.git` directory (commits, refs, index,
/// stashes, …) AND the working tree, so a plain editor save is noticed too.
///
/// Watching the worktree recursively is CHEAP — measured at ~200ms on a large
/// monorepo. What made an earlier attempt hang for tens of seconds was
/// `cache().add_root(worktree, Recursive)`, which walks and stats the entire tree
/// (measured: 14.5s, versus 39ms for `.git` alone). We never inspect event kinds
/// or correlate renames — the callback only asks "did anything change?" — so the
/// worktree needs no cache entry at all, and the walk is simply not done.
///
/// Replaces (and drops) any previously installed watcher so switching repos
/// doesn't leak watchers.
pub fn watch(app: &tauri::AppHandle, repo_path: &str) {
    let Some(dir) = git_dir(app, repo_path) else {
        return;
    };
    let app_for_events = app.clone();
    let worktree = PathBuf::from(repo_path);
    let ignore = build_ignore(&worktree);
    let git_dir_for_events = dir.clone();
    let debouncer = new_debouncer(
        DEBOUNCE,
        Some(TICK),
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                let relevant = events.iter().any(|e| {
                    e.paths
                        .iter()
                        .any(|p| is_relevant(p, &git_dir_for_events, ignore.as_ref()))
                });
                if relevant {
                    let _ = RepoChanged {}.emit(&app_for_events);
                }
            }
        },
    );
    if let Ok(mut deb) = debouncer {
        if deb.watcher().watch(&dir, RecursiveMode::Recursive).is_ok() {
            // Cache only for `.git`: 39ms, and it keeps rename correlation there.
            // Deliberately NOT for the worktree — see the note above.
            deb.cache().add_root(&dir, RecursiveMode::Recursive);
            // Best-effort: a worktree we can't watch (permissions, a path that
            // vanished) just means editor saves need ↻ again, so don't give up the
            // `.git` watch over it.
            let _ = deb.watcher().watch(&worktree, RecursiveMode::Recursive);
            let state = app.state::<RepoWatcher>();
            // Replace (and drop/stop) any previous watcher.
            *state.0.lock().unwrap() = Some(deb);
        }
    }
}

/// Stop watching by dropping the stored debouncer.
pub fn unwatch(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<RepoWatcher>() {
        *state.0.lock().unwrap() = None; // drop → stops watching
    }
}

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

#[cfg(test)]
mod tests {
	use super::*;

	fn repo_with_gitignore(contents: &str) -> tempfile::TempDir {
		let d = tempfile::tempdir().unwrap();
		std::fs::create_dir_all(d.path().join(".git").join("info")).unwrap();
		std::fs::write(d.path().join(".gitignore"), contents).unwrap();
		d
	}

	/// The point of filtering: a build or `yarn install` writes thousands of files
	/// under an ignored directory, and without this each 400ms window would fire a
	/// reload for the whole duration.
	#[test]
	fn ignored_paths_do_not_wake_the_ui() {
		let d = repo_with_gitignore("node_modules/\ntarget/\n");
		let root = d.path();
		let git_dir = root.join(".git");
		let ig = build_ignore(root);

		for ignored in [
			root.join("node_modules").join("react").join("index.js"),
			root.join("target").join("debug").join("build.o"),
		] {
			assert!(
				!is_relevant(&ignored, &git_dir, ig.as_ref()),
				"{ignored:?} should be ignored"
			);
		}
	}

	#[test]
	fn tracked_files_wake_the_ui() {
		let d = repo_with_gitignore("node_modules/\n");
		let root = d.path();
		let git_dir = root.join(".git");
		let ig = build_ignore(root);

		assert!(is_relevant(&root.join("src").join("main.rs"), &git_dir, ig.as_ref()));
	}

	/// `.git` is inside the worktree, so the worktree watch sees it too — and it
	/// must never be filtered, whatever the ignore rules say. It IS the repo state.
	#[test]
	fn git_dir_changes_always_wake_the_ui() {
		let d = repo_with_gitignore("*\n");
		let root = d.path();
		let git_dir = root.join(".git");
		let ig = build_ignore(root);

		assert!(is_relevant(&git_dir.join("index"), &git_dir, ig.as_ref()));
		assert!(is_relevant(
			&git_dir.join("refs").join("heads").join("main"),
			&git_dir,
			ig.as_ref()
		));
	}

	/// `.git/info/exclude` is a real ignore source and users do rely on it.
	#[test]
	fn info_exclude_is_honoured() {
		let d = repo_with_gitignore("");
		let root = d.path();
		std::fs::write(root.join(".git").join("info").join("exclude"), "scratch/\n")
			.unwrap();
		let git_dir = root.join(".git");
		let ig = build_ignore(root);

		assert!(!is_relevant(&root.join("scratch").join("x.txt"), &git_dir, ig.as_ref()));
	}

	/// The crate returns an error for a tick larger than the timeout, which would
	/// leave the app with no watcher at all — and the whole point of setting it
	/// explicitly is to avoid the 100ms default, so pin both ends.
	#[test]
	fn tick_is_explicit_and_within_the_timeout() {
		assert!(TICK <= DEBOUNCE, "a tick > timeout makes new_debouncer fail");
		assert!(
			TICK > DEBOUNCE / 4,
			"the point is to wake LESS often than the crate's timeout/4 default"
		);
	}

	/// No .gitignore at all must not mean "ignore everything".
	#[test]
	fn without_ignore_rules_everything_is_relevant() {
		let d = tempfile::tempdir().unwrap();
		let root = d.path();
		let git_dir = root.join(".git");

		assert!(is_relevant(&root.join("a.txt"), &git_dir, None));
		let ig = build_ignore(root);
		assert!(is_relevant(&root.join("a.txt"), &git_dir, ig.as_ref()));
	}
}
