use crate::git::run::{run, GitError};
use crate::git::stage::head_exists;
use serde::Serialize;

/// Result of a commit attempt. A hook rejection is NOT modelled as an error:
/// the command's own output is the useful part, and the UI shows it in the
/// output panel either way.
#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CommitOutcome {
	pub ok: bool,
	/// The new commit's SHA — `None` when the commit didn't happen.
	pub sha: Option<String>,
	/// stdout followed by stderr, which is how the user would have seen it in a
	/// terminal.
	pub output: String,
}

/// Joins a command's two streams in the order a terminal would show them.
/// Either may be empty; the result has no leading or trailing blank lines.
pub fn combine_output(stdout: &str, stderr: &str) -> String {
	[stdout.trim_end(), stderr.trim_end()]
		.iter()
		.filter(|s| !s.is_empty())
		.copied()
		.collect::<Vec<_>>()
		.join("\n")
}

/// Builds the full `git` argv (starting at `"commit"`) for a commit.
///
/// The message is a single argv element — no shell is involved anywhere in
/// `run`, so newlines, quotes and `$` need no escaping. Deliberately does NOT
/// pass `--no-verify`: pre-commit / commit-msg hooks must run (that's the whole
/// reason this project shells out to the system git binary), and a hook that
/// rejects the commit reports itself through the streamed output.
pub fn commit_args<'a>(message: &'a str, amend: bool) -> Vec<&'a str> {
	let mut args = vec!["commit"];
	if amend {
		args.push("--amend");
	}
	args.push("-m");
	args.push(message);
	args
}

/// Commits the staged index.
///
/// A failed commit — "nothing to commit", or a `pre-commit`/`commit-msg` hook
/// rejecting it — comes back as `Ok(CommitOutcome { ok: false, .. })` carrying
/// the command's output, NOT as an `Err`. Hook failures are the common case in
/// real repos and the hook's own message (on either stream) is the only thing
/// that explains them, so it must survive to the UI intact.
///
/// Runs via `run_streaming`, and `run_id` correlates the resulting
/// `CommandChunk`/`CommandDone` events so the UI can show hook output as it
/// happens rather than after the fact — hooks routinely take seconds, and a
/// buffered command shows nothing until it's already over.
pub fn commit(
	app: &tauri::AppHandle,
	repo_path: &str,
	message: &str,
	amend: bool,
	run_id: &str,
) -> Result<CommitOutcome, GitError> {
	let o = crate::git::stream::run_streaming(
		app,
		repo_path,
		&commit_args(message, amend),
		run_id,
	)?;
	let output = combine_output(&o.stdout, &o.stderr);
	if o.exit_code != 0 {
		return Ok(CommitOutcome { ok: false, sha: None, output });
	}
	let sha = run(app, repo_path, &["rev-parse", "HEAD"])?;
	Ok(CommitOutcome { ok: true, sha: Some(sha.trim().to_string()), output })
}

/// `HEAD`'s full commit message, used to prefill the message box when the user
/// ticks "Amend". `None` on an unborn branch (no commits yet), where there is
/// nothing to amend — checked up front because `git log` would otherwise exit
/// 128 and be reported as a real error.
pub fn head_commit_message(
	app: &tauri::AppHandle,
	repo_path: &str,
) -> Result<Option<String>, GitError> {
	if !head_exists(app, repo_path) {
		return Ok(None);
	}
	let msg = run(app, repo_path, &["log", "-1", "--pretty=%B"])?;
	Ok(Some(msg.trim_end_matches('\n').to_string()))
}

/// The full message (subject + body) of an arbitrary commit, for the read-only
/// message panel in the history view.
///
/// `log_commits` only carries `%s`, so the body of a commit is otherwise not
/// available anywhere in the app. Fetched per selection rather than widening
/// the paginated log format, which would carry every body for every row.
///
/// The trailing `--` disambiguates: without it a `hash` that happened to match
/// a filename would be read as a pathspec.
pub fn commit_message(
	app: &tauri::AppHandle,
	repo_path: &str,
	hash: &str,
) -> Result<String, GitError> {
	let msg = run(app, repo_path, &["log", "-1", "--pretty=format:%B", hash, "--"])?;
	Ok(msg.trim_end().to_string())
}

/// Splits the NUL-delimited `git log --pretty=%B%x00` output into individual
/// messages. Commit messages routinely contain newlines, so NUL is the only
/// safe separator; git emits a trailing NUL, hence the empty final record.
/// Blank messages are dropped — they'd be useless entries in the recall list.
pub fn parse_recent_messages(z: &str) -> Vec<String> {
	z.split('\u{0}')
		.map(|m| m.trim().to_string())
		.filter(|m| !m.is_empty())
		.collect()
}

/// The last `limit` commit messages, newest first, for the "reuse a recent
/// message" recall list. Empty on an unborn branch rather than an error.
pub fn recent_commit_messages(
	app: &tauri::AppHandle,
	repo_path: &str,
	limit: u32,
) -> Result<Vec<String>, GitError> {
	if !head_exists(app, repo_path) {
		return Ok(Vec::new());
	}
	let n = limit.to_string();
	let z = run(app, repo_path, &["log", "-n", &n, "--pretty=format:%B%x00"])?;
	Ok(parse_recent_messages(&z))
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;

	fn git(dir: &std::path::Path, args: &[&str]) {
		Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
	}

	fn git_stdout(dir: &std::path::Path, args: &[&str]) -> String {
		let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
		String::from_utf8_lossy(&out.stdout).to_string()
	}

	fn commit_count(dir: &std::path::Path) -> usize {
		git_stdout(dir, &["rev-list", "--count", "HEAD"]).trim().parse().unwrap()
	}

	fn head_message(dir: &std::path::Path) -> String {
		git_stdout(dir, &["log", "-1", "--pretty=%B"]).trim_end().to_string()
	}

	fn repo_with_committed_file() -> tempfile::TempDir {
		let d = tempfile::tempdir().unwrap();
		let p = d.path();
		git(p, &["init", "-q", "-b", "main"]);
		git(p, &["config", "user.email", "t@e.st"]);
		git(p, &["config", "user.name", "T"]);
		std::fs::write(p.join("f.txt"), "a\n").unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-qm", "base"]);
		d
	}

	#[test]
	fn combine_output_orders_stdout_then_stderr() {
		assert_eq!(combine_output("out\n", "err\n"), "out\nerr");
	}

	/// A hook that prints only to stdout (husky/yarn wrappers do) must still
	/// produce a non-empty message — the whole reason `Outcome` carries both
	/// streams.
	#[test]
	fn combine_output_survives_an_empty_stream() {
		assert_eq!(combine_output("only stdout\n", ""), "only stdout");
		assert_eq!(combine_output("", "only stderr\n"), "only stderr");
		assert_eq!(combine_output("", ""), "");
	}

	/// The scenario reported on `configurator`: a `pre-commit` hook fails
	/// because a tool is missing. git must exit non-zero, no commit may be
	/// created, and the hook's own output has to be recoverable.
	///
	/// Unix-only: it depends on a `#!/bin/sh` hook being executable, which is
	/// not how hook execution works on Windows. The behaviour under test
	/// (`combine_output` surfacing a non-zero command's stdout) is
	/// platform-independent and covered by the pure tests above.
	#[cfg(unix)]
	#[test]
	fn rejected_by_pre_commit_hook_leaves_no_commit_and_explains_itself() {
		let d = repo_with_committed_file();
		let p = d.path();
		let hooks = p.join(".git").join("hooks");
		std::fs::create_dir_all(&hooks).unwrap();
		let hook = hooks.join("pre-commit");
		// Prints to STDOUT, like a missing-tool wrapper would, then fails.
		std::fs::write(&hook, "#!/bin/sh\necho 'yarn: command not found'\nexit 1\n").unwrap();
		use std::os::unix::fs::PermissionsExt;
		std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		git(p, &["add", "--", "f.txt"]);

		let out = Command::new("git")
			.arg("-C")
			.arg(p)
			.args(commit_args("blocked", false))
			.output()
			.unwrap();

		assert!(!out.status.success(), "the hook must block the commit");
		assert_eq!(commit_count(p), 1, "no commit may be created");
		let combined = combine_output(
			&String::from_utf8_lossy(&out.stdout),
			&String::from_utf8_lossy(&out.stderr),
		);
		assert!(
			combined.contains("yarn: command not found"),
			"the hook's stdout must reach the user; got {:?}",
			combined
		);
	}

	#[test]
	fn commit_args_plain() {
		assert_eq!(commit_args("hello", false), ["commit", "-m", "hello"]);
	}

	#[test]
	fn commit_args_amend() {
		assert_eq!(commit_args("hello", true), ["commit", "--amend", "-m", "hello"]);
	}

	/// Hooks must run, so `--no-verify` must never sneak into the argv.
	#[test]
	fn commit_args_never_skip_hooks() {
		for amend in [false, true] {
			assert!(
				!commit_args("m", amend).contains(&"--no-verify"),
				"commit must let pre-commit / commit-msg hooks run"
			);
		}
	}

	/// `commit` needs an `AppHandle` (unavailable in unit tests), so — same
	/// approach as `stage.rs` — these shell out directly with exactly the argv
	/// `commit_args` produces and assert at the git level.
	#[test]
	fn commit_creates_commit_with_message() {
		let d = repo_with_committed_file();
		let p = d.path();
		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		git(p, &["add", "--", "f.txt"]);
		assert_eq!(commit_count(p), 1, "sanity: one commit before");

		git(p, &commit_args("second change", false));

		assert_eq!(commit_count(p), 2, "a new commit should have been added");
		assert_eq!(head_message(p), "second change");
	}

	#[test]
	fn amend_replaces_head_without_adding_commit() {
		let d = repo_with_committed_file();
		let p = d.path();
		assert_eq!(commit_count(p), 1, "sanity: one commit before");

		git(p, &commit_args("reworded", true));

		assert_eq!(commit_count(p), 1, "amend must rewrite HEAD, not add a commit");
		assert_eq!(head_message(p), "reworded");
	}

	/// Guards the "message is one argv element, no shell escaping needed"
	/// claim: a subject + blank line + body must survive intact.
	#[test]
	fn commit_preserves_multiline_message() {
		let d = repo_with_committed_file();
		let p = d.path();
		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		git(p, &["add", "--", "f.txt"]);

		let message = "subject line\n\nbody with \"quotes\" and $VAR\n";
		git(p, &commit_args(message, false));

		assert_eq!(head_message(p), "subject line\n\nbody with \"quotes\" and $VAR");
	}

	/// The whole point of the read-only message panel: a commit's BODY is not
	/// carried by `log_commits` (`%s` only), so fetching it per-commit must
	/// return subject *and* body — for an arbitrary commit, not just HEAD.
	#[test]
	fn commit_message_returns_full_body_of_an_older_commit() {
		let d = repo_with_committed_file();
		let p = d.path();
		let older = git_stdout(p, &["rev-parse", "HEAD"]).trim().to_string();
		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		git(p, &["add", "--", "f.txt"]);
		git(p, &commit_args("subject\n\nbody paragraph\nsecond line\n", false));

		let head_msg = git_stdout(p, &["log", "-1", "--pretty=format:%B", "HEAD", "--"]);
		let older_msg = git_stdout(p, &["log", "-1", "--pretty=format:%B", &older, "--"]);

		assert_eq!(
			head_msg.trim_end(),
			"subject\n\nbody paragraph\nsecond line",
			"body must come back, not just the subject"
		);
		assert_eq!(older_msg.trim_end(), "base", "an older commit resolves too");
	}

	#[test]
	fn parse_recent_messages_splits_on_nul_and_keeps_multiline() {
		let z = "subject one\n\nbody one\n\u{0}subject two\n\u{0}";

		assert_eq!(
			parse_recent_messages(z),
			vec!["subject one\n\nbody one".to_string(), "subject two".to_string()],
			"messages split on NUL, trailing empty record dropped, bodies intact"
		);
	}

	#[test]
	fn parse_recent_messages_drops_blank_entries() {
		assert_eq!(parse_recent_messages("\u{0}   \n\u{0}real\u{0}"), vec!["real".to_string()]);
	}

	/// End-to-end against real git: the recall list must come back newest-first.
	#[test]
	fn recent_messages_are_newest_first() {
		let d = repo_with_committed_file();
		let p = d.path();
		std::fs::write(p.join("f.txt"), "b\n").unwrap();
		git(p, &["add", "--", "f.txt"]);
		git(p, &["commit", "-qm", "second"]);

		let z = git_stdout(p, &["log", "-n", "10", "--pretty=format:%B%x00"]);

		assert_eq!(
			parse_recent_messages(&z),
			vec!["second".to_string(), "base".to_string()],
			"newest commit first"
		);
	}

	/// The condition `head_commit_message` gates on: on a fresh `init` there is
	/// no HEAD commit, so `git log` fails and we must return `None` instead of
	/// propagating that as an error.
	#[test]
	fn head_commit_message_none_on_unborn_branch() {
		let d = tempfile::tempdir().unwrap();
		let p = d.path();
		git(p, &["init", "-q", "-b", "main"]);

		let out = Command::new("git")
			.arg("-C")
			.arg(p)
			.args(["log", "-1", "--pretty=%B"])
			.output()
			.unwrap();

		assert!(!out.status.success(), "git log must fail on an unborn branch");
	}
}
