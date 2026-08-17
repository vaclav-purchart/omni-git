use crate::git::run::{run, run_allowing, GitError};

pub fn stage_file(app: &tauri::AppHandle, repo_path: &str, path: &str) -> Result<(), GitError> {
	run(app, repo_path, &["add", "--", path]).map(|_| ())
}

/// Whether `HEAD` resolves to a commit, i.e. whether this is NOT an unborn
/// branch (a freshly-`git init`'d repo with no commits yet). `--quiet`
/// suppresses the "fatal: ..." message; on failure there's no stdout output
/// either, so an empty (trimmed) stdout means HEAD doesn't resolve. Exit code
/// 1 is the normal "doesn't resolve" case, so it's allowed through via
/// `run_allowing` rather than treated as an error.
pub fn head_exists(app: &tauri::AppHandle, repo_path: &str) -> bool {
	run_allowing(app, repo_path, &["rev-parse", "--verify", "--quiet", "HEAD"], &[1])
		.map(|stdout| !stdout.trim().is_empty())
		.unwrap_or(false)
}

/// Unstages a single path. `git restore --staged` requires `HEAD` to exist
/// (it restores the index from HEAD), so on an unborn branch (no commits
/// yet) it fails with "fatal: could not resolve HEAD". `git rm --cached`
/// only touches the index — never the worktree — so it's the correct
/// unstage primitive pre-first-commit.
pub fn unstage_file(app: &tauri::AppHandle, repo_path: &str, path: &str) -> Result<(), GitError> {
	if head_exists(app, repo_path) {
		run(app, repo_path, &["restore", "--staged", "--", path]).map(|_| ())
	} else {
		run(app, repo_path, &["rm", "--cached", "--", path]).map(|_| ())
	}
}

pub fn stage_all(app: &tauri::AppHandle, repo_path: &str) -> Result<(), GitError> {
	run(app, repo_path, &["add", "-A"]).map(|_| ())
}

/// Stages the Unstaged group only: `git add -u` touches tracked files, leaving
/// untracked ones alone. `add -A`/`add .` would sweep those in too, which is not
/// what a per-group action should do.
pub fn stage_tracked(app: &tauri::AppHandle, repo_path: &str) -> Result<(), GitError> {
	run(app, repo_path, &["add", "-u"]).map(|_| ())
}

/// Stages an explicit set of paths — used for the Untracked group, where git has
/// no "all untracked" pathspec and every alternative also stages tracked edits.
///
/// The paths come from the status we just read, so the list is bounded by what is
/// actually untracked. A repo with thousands of untracked files could in principle
/// exceed the platform's argv limit; git's own error surfaces if so.
pub fn stage_paths(
	app: &tauri::AppHandle,
	repo_path: &str,
	paths: &[String],
) -> Result<(), GitError> {
	if paths.is_empty() {
		return Ok(());
	}
	let mut args: Vec<&str> = vec!["add", "--"];
	args.extend(paths.iter().map(String::as_str));
	run(app, repo_path, &args).map(|_| ())
}

/// Unstages an explicit set of paths — the multi-selection counterpart of
/// `unstage_file`.
///
/// See `unstage_file` for why an unborn branch needs `rm --cached` instead:
/// `restore --staged` resolves paths against `HEAD`, which doesn't exist yet.
pub fn unstage_paths(
	app: &tauri::AppHandle,
	repo_path: &str,
	paths: &[String],
) -> Result<(), GitError> {
	if paths.is_empty() {
		return Ok(());
	}
	let mut args: Vec<&str> = if head_exists(app, repo_path) {
		vec!["restore", "--staged", "--"]
	} else {
		vec!["rm", "--cached", "--"]
	};
	args.extend(paths.iter().map(String::as_str));
	run(app, repo_path, &args).map(|_| ())
}

/// Discards the unstaged edits to an explicit set of TRACKED paths.
///
/// One `git` invocation rather than one per file: a partial failure half-way
/// through a loop would leave the user with some files discarded and some not,
/// and no way to tell which.
pub fn discard_paths(
	app: &tauri::AppHandle,
	repo_path: &str,
	paths: &[String],
) -> Result<(), GitError> {
	if paths.is_empty() {
		return Ok(());
	}
	let mut args: Vec<&str> = vec!["restore", "--worktree", "--"];
	args.extend(paths.iter().map(String::as_str));
	run(app, repo_path, &args).map(|_| ())
}

/// Deletes an explicit set of untracked paths.
///
/// `-d` as well as `-f`, matching the group-level `clean_untracked`: status is
/// read with `--untracked-files=all` so these are normally files, but a directory
/// created between that read and the click would otherwise be skipped with a
/// warning rather than deleted.
pub fn clean_paths(
	app: &tauri::AppHandle,
	repo_path: &str,
	paths: &[String],
) -> Result<(), GitError> {
	if paths.is_empty() {
		return Ok(());
	}
	let mut args: Vec<&str> = vec!["clean", "-fd", "--"];
	args.extend(paths.iter().map(String::as_str));
	run(app, repo_path, &args).map(|_| ())
}

/// Discards every unstaged edit to tracked files, leaving the index and untracked
/// files alone — the group-level counterpart of `discard_file`.
pub fn discard_all_unstaged(
	app: &tauri::AppHandle,
	repo_path: &str,
) -> Result<(), GitError> {
	run(app, repo_path, &["restore", "--worktree", "--", "."]).map(|_| ())
}

/// Deletes every untracked file. `-d` so untracked DIRECTORIES go too, which is
/// what the Untracked group shows (status is read with `--untracked-files=all`).
pub fn clean_untracked(app: &tauri::AppHandle, repo_path: &str) -> Result<(), GitError> {
	run(app, repo_path, &["clean", "-fd"]).map(|_| ())
}

/// See `unstage_file` for why the unborn-branch case needs a different
/// primitive than `git restore --staged`.
pub fn unstage_all(app: &tauri::AppHandle, repo_path: &str) -> Result<(), GitError> {
	if head_exists(app, repo_path) {
		run(app, repo_path, &["restore", "--staged", "."]).map(|_| ())
	} else {
		run(app, repo_path, &["rm", "-r", "--cached", "--", "."]).map(|_| ())
	}
}

pub fn discard_file(
	app: &tauri::AppHandle,
	repo_path: &str,
	path: &str,
	untracked: bool,
) -> Result<(), GitError> {
	let args: Vec<&str> = if untracked {
		vec!["clean", "-f", "--", path]
	} else {
		vec!["restore", "--worktree", "--", path]
	};
	run(app, repo_path, &args).map(|_| ())
}

#[cfg(test)]
mod tests {
	use std::process::Command;

	fn git(dir: &std::path::Path, args: &[&str]) {
		Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
	}

	/// `git status --porcelain` output for the repo at `dir`.
	fn status(dir: &std::path::Path) -> String {
		let out = Command::new("git")
			.arg("-C")
			.arg(dir)
			.args(["status", "--porcelain"])
			.output()
			.unwrap();
		String::from_utf8_lossy(&out.stdout).to_string()
	}

	/// The two-char XY porcelain status code for `filename`, if it appears in
	/// `status_output`. Porcelain lines are "XY filename", so this looks at
	/// the line's own prefix rather than substring-searching the whole
	/// output (which false-positives: e.g. " M f.txt" contains "M " as a
	/// substring even though the staged column X is actually blank).
	fn code_for<'a>(status_output: &'a str, filename: &str) -> Option<&'a str> {
		status_output.lines().find_map(|line| {
			if line.get(3..).map(|rest| rest == filename).unwrap_or(false) {
				line.get(0..2)
			} else {
				None
			}
		})
	}

	fn repo_with_committed_file(content: &str) -> tempfile::TempDir {
		let d = tempfile::tempdir().unwrap();
		let p = d.path();
		git(p, &["init", "-q", "-b", "main"]);
		git(p, &["config", "user.email", "t@e.st"]);
		git(p, &["config", "user.name", "T"]);
		std::fs::write(p.join("f.txt"), content).unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-qm", "base"]);
		d
	}

	#[test]
	fn stage_then_status_shows_staged() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		assert!(status(p).starts_with(" M"), "unstaged modification should show as ' M'");

		git(p, &["add", "--", "f.txt"]);

		assert!(status(p).starts_with("M "), "staged modification should show as 'M '");
	}

	#[test]
	fn unstage_then_status_shows_unstaged() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		git(p, &["add", "--", "f.txt"]);
		assert!(status(p).starts_with("M "), "sanity: change is staged before unstaging");

		git(p, &["restore", "--staged", "--", "f.txt"]);

		assert!(status(p).starts_with(" M"), "unstaging should return to ' M'");
	}

	/// The property multi-select depends on: acting on a set of paths must leave
	/// every other changed file exactly as it was.
	#[test]
	fn unstage_paths_leaves_unlisted_files_staged() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		for name in ["f.txt", "g.txt", "h.txt"] {
			std::fs::write(p.join(name), "changed\n").unwrap();
		}
		git(p, &["add", "-A"]);
		let before = status(p);
		assert_eq!(code_for(&before, "g.txt"), Some("A "), "sanity: all three staged");

		git(p, &["restore", "--staged", "--", "f.txt", "h.txt"]);

		let after = status(p);
		assert_eq!(code_for(&after, "f.txt"), Some(" M"), "listed file unstaged");
		assert_eq!(code_for(&after, "h.txt"), Some("??"), "listed new file unstaged");
		assert_eq!(code_for(&after, "g.txt"), Some("A "), "unlisted file untouched");
	}

	#[test]
	fn discard_paths_leaves_unlisted_edits_alone() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		std::fs::write(p.join("g.txt"), "base\n").unwrap();
		git(p, &["add", "-A"]);
		git(p, &["commit", "-qm", "two files"]);
		std::fs::write(p.join("f.txt"), "edited\n").unwrap();
		std::fs::write(p.join("g.txt"), "edited\n").unwrap();

		git(p, &["restore", "--worktree", "--", "f.txt"]);

		let after = status(p);
		assert_eq!(code_for(&after, "f.txt"), None, "listed file restored");
		assert_eq!(code_for(&after, "g.txt"), Some(" M"), "unlisted edit survives");
	}

	/// -fd, not -f: a directory would otherwise be skipped with a warning rather
	/// than deleted, and the caller would be told it succeeded.
	#[test]
	fn clean_paths_removes_listed_untracked_including_directories() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		std::fs::write(p.join("u1.txt"), "x\n").unwrap();
		std::fs::write(p.join("u2.txt"), "x\n").unwrap();
		std::fs::create_dir(p.join("udir")).unwrap();
		std::fs::write(p.join("udir/inner.txt"), "x\n").unwrap();

		git(p, &["clean", "-fd", "--", "u1.txt", "udir"]);

		assert!(!p.join("u1.txt").exists(), "listed file deleted");
		assert!(!p.join("udir").exists(), "listed directory deleted");
		assert!(p.join("u2.txt").exists(), "unlisted untracked file survives");
	}

	#[test]
	fn stage_all_stages_untracked_and_modified() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		std::fs::write(p.join("u.txt"), "untracked\n").unwrap();
		let before = status(p);
		assert_eq!(code_for(&before, "f.txt"), Some(" M"), "sanity: modified but unstaged");
		assert_eq!(code_for(&before, "u.txt"), Some("??"), "sanity: untracked file present");

		git(p, &["add", "-A"]);

		let after = status(p);
		assert_eq!(code_for(&after, "f.txt"), Some("M "), "modification should now be staged");
		assert_eq!(code_for(&after, "u.txt"), Some("A "), "new file should be staged as added");
	}

	#[test]
	fn unstage_all_clears_index() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		std::fs::write(p.join("u.txt"), "untracked\n").unwrap();
		git(p, &["add", "-A"]);
		let before = status(p);
		assert_eq!(code_for(&before, "f.txt"), Some("M "), "sanity: staged before unstage_all");
		assert_eq!(code_for(&before, "u.txt"), Some("A "), "sanity: staged before unstage_all");

		git(p, &["restore", "--staged", "."]);

		let after = status(p);
		assert_eq!(
			code_for(&after, "f.txt"),
			Some(" M"),
			"tracked modification should be back to unstaged"
		);
		assert_eq!(
			code_for(&after, "u.txt"),
			Some("??"),
			"new file should be back to untracked"
		);
	}

	/// THE key semantic test: `git restore --worktree` must discard ONLY the
	/// unstaged worktree edit and KEEP the staged version. Build an `MM`
	/// state: commit "a\n"; write "b\n" + stage it; then write "c\n" so the
	/// worktree diverges further from the index. Discarding the worktree
	/// change must bring the file back to the STAGED content ("b\n"), not the
	/// committed content ("a\n"), and status must show a staged-only `M `.
	#[test]
	fn discard_unstaged_keeps_staged() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();

		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		git(p, &["add", "--", "f.txt"]);
		std::fs::write(p.join("f.txt"), "c\n").unwrap();

		let before = status(p);
		assert!(before.starts_with("MM"), "sanity: staged=b vs HEAD, worktree=c vs staged");

		git(p, &["restore", "--worktree", "--", "f.txt"]);

		let worktree_content = std::fs::read_to_string(p.join("f.txt")).unwrap();
		assert_eq!(
			worktree_content, "b\n",
			"worktree should be restored to the STAGED content, not HEAD's"
		);
		let after = status(p);
		assert!(
			after.starts_with("M "),
			"only the staged change should remain, worktree change is gone; got: {:?}",
			after
		);
	}

	/// An `init`-only repo with no commits yet — an "unborn branch". `HEAD`
	/// exists as a symbolic ref (pointing at `refs/heads/main`) but does not
	/// resolve to a commit, so `git rev-parse --verify --quiet HEAD` fails
	/// and `git restore --staged` errors with "fatal: could not resolve
	/// HEAD".
	fn repo_without_commit() -> tempfile::TempDir {
		let d = tempfile::tempdir().unwrap();
		let p = d.path();
		git(p, &["init", "-q", "-b", "main"]);
		git(p, &["config", "user.email", "t@e.st"]);
		git(p, &["config", "user.name", "T"]);
		d
	}

	/// These fns need an `AppHandle` (unavailable in unit tests), so — same
	/// approach as the rest of this module's tests — we shell out directly,
	/// mirroring exactly the commands `unstage_file`'s unborn-branch fallback
	/// issues, and assert at the git level.
	#[test]
	fn unstage_file_on_unborn_branch_falls_back_to_rm_cached() {
		let d = repo_without_commit();
		let p = d.path();
		std::fs::write(p.join("f.txt"), "a\n").unwrap();
		git(p, &["add", "--", "f.txt"]);
		assert_eq!(
			code_for(&status(p), "f.txt"),
			Some("A "),
			"sanity: staged as added on an unborn branch"
		);

		let head_check = Command::new("git")
			.arg("-C")
			.arg(p)
			.args(["rev-parse", "--verify", "--quiet", "HEAD"])
			.output()
			.unwrap();
		assert!(
			!head_check.status.success(),
			"sanity: HEAD should not resolve on an unborn branch"
		);

		git(p, &["rm", "--cached", "--", "f.txt"]);

		let after = status(p);
		assert_eq!(
			code_for(&after, "f.txt"),
			Some("??"),
			"file should become untracked again"
		);
		assert!(
			p.join("f.txt").exists(),
			"rm --cached must not touch the worktree"
		);
	}

	#[test]
	fn unstage_all_on_unborn_branch_falls_back_to_rm_cached() {
		let d = repo_without_commit();
		let p = d.path();
		std::fs::write(p.join("f.txt"), "a\n").unwrap();
		std::fs::write(p.join("g.txt"), "b\n").unwrap();
		git(p, &["add", "-A"]);
		let before = status(p);
		assert_eq!(code_for(&before, "f.txt"), Some("A "), "sanity: staged before unstage_all");
		assert_eq!(code_for(&before, "g.txt"), Some("A "), "sanity: staged before unstage_all");

		git(p, &["rm", "-r", "--cached", "--", "."]);

		let after = status(p);
		assert_eq!(
			code_for(&after, "f.txt"),
			Some("??"),
			"file should become untracked again"
		);
		assert_eq!(
			code_for(&after, "g.txt"),
			Some("??"),
			"file should become untracked again"
		);
		assert!(p.join("f.txt").exists(), "rm --cached must not touch the worktree");
		assert!(p.join("g.txt").exists(), "rm --cached must not touch the worktree");
	}

	/// `add -u` must stage the tracked modification and LEAVE the untracked file
	/// alone — `add -A`/`add .` would sweep it in, which is the mistake this
	/// command exists to avoid.
	#[test]
	fn stage_tracked_ignores_untracked_files() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		std::fs::write(p.join("u.txt"), "new\n").unwrap();

		git(p, &["add", "-u"]);

		let after = status(p);
		assert_eq!(code_for(&after, "f.txt"), Some("M "), "tracked edit staged");
		assert_eq!(code_for(&after, "u.txt"), Some("??"), "untracked left alone");
	}

	/// Discarding the Unstaged group must not touch the index or untracked files.
	#[test]
	fn discard_all_unstaged_keeps_staged_and_untracked() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		// A second tracked file, committed, so both start clean.
		std::fs::write(p.join("g.txt"), "g\n").unwrap();
		git(p, &["add", "--", "g.txt"]);
		git(p, &["commit", "-qm", "add g"]);

		// Now: f.txt staged, g.txt edited but unstaged, u.txt untracked.
		std::fs::write(p.join("f.txt"), "staged\n").unwrap();
		git(p, &["add", "--", "f.txt"]);
		std::fs::write(p.join("g.txt"), "unstaged edit\n").unwrap();
		std::fs::write(p.join("u.txt"), "new\n").unwrap();

		git(p, &["restore", "--worktree", "--", "."]);

		let after = status(p);
		assert_eq!(code_for(&after, "f.txt"), Some("M "), "staged change survives");
		assert_eq!(
			std::fs::read_to_string(p.join("g.txt")).unwrap(),
			"g\n",
			"unstaged edit discarded"
		);
		assert_eq!(code_for(&after, "u.txt"), Some("??"), "untracked left alone");
	}

	/// `clean -fd` must take untracked DIRECTORIES too: status is read with
	/// `--untracked-files=all`, so the group shows files inside them.
	#[test]
	fn clean_untracked_removes_files_and_directories() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		std::fs::write(p.join("u.txt"), "new\n").unwrap();
		std::fs::create_dir(p.join("newdir")).unwrap();
		std::fs::write(p.join("newdir").join("inner.txt"), "x\n").unwrap();
		std::fs::write(p.join("f.txt"), "modified\n").unwrap();

		git(p, &["clean", "-fd"]);

		assert!(!p.join("u.txt").exists(), "untracked file removed");
		assert!(!p.join("newdir").exists(), "untracked directory removed");
		assert_eq!(
			std::fs::read_to_string(p.join("f.txt")).unwrap(),
			"modified\n",
			"tracked modification untouched"
		);
	}

	#[test]
	fn discard_untracked_deletes_file() {
		let d = repo_with_committed_file("a\n");
		let p = d.path();
		std::fs::write(p.join("u.txt"), "untracked\n").unwrap();
		assert!(status(p).contains("??"), "sanity: untracked file present");

		git(p, &["clean", "-f", "--", "u.txt"]);

		assert!(!p.join("u.txt").exists(), "untracked file should be deleted from disk");
		assert!(!status(p).contains("u.txt"), "untracked file should be gone from status");
	}
}
