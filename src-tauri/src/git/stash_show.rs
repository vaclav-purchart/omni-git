//! Reading what is inside a stash, and putting it back.
//!
//! A stash is not one commit but up to three: the working tree (`<sel>`), the
//! index at the time (`<sel>^2`), and — only when `-u` was used — the untracked
//! files (`<sel>^3`), all hanging off the commit that was `HEAD` (`<sel>^1`).
//! That shape is why the diffs here take two different routes.

use crate::git::changes::{FileChange, dedupe_by_path, parse_name_status};
use crate::git::commit::{CommitOutcome, combine_output};
use crate::git::run::{GitError, run, run_allowing, run_capturing};
use crate::git::stream::run_streaming;

/// `git stash show -u --name-status -z <selector>`.
///
/// `-u` so untracked files that were stashed are listed too; without it they are
/// silently missing from a stash the user explicitly took them into. `-z` for the
/// same NUL-separated format the commit file list already parses.
pub fn files_args(selector: &str) -> Vec<String> {
	vec![
		"stash".into(),
		"show".into(),
		"-u".into(),
		"--name-status".into(),
		"-z".into(),
		selector.to_string(),
	]
}

/// `git ls-tree ... <selector>^3 -- <path>`, which answers "was this path stashed
/// as an untracked file?".
///
/// Exits non-zero when `^3` doesn't exist at all, which is the normal case for a
/// stash taken without `-u` — see `is_untracked`.
pub fn untracked_probe_args(selector: &str, path: &str) -> Vec<String> {
	vec![
		"ls-tree".into(),
		"-r".into(),
		"--name-only".into(),
		format!("{selector}^3"),
		"--".into(),
		path.to_string(),
	]
}

/// Reads the probe: a path is untracked-in-the-stash only if `^3` both exists and
/// contains it. A failed probe means there was no untracked commit, so the path
/// must be a tracked change.
pub fn is_untracked(probe_exit_code: i32, probe_stdout: &str) -> bool {
	probe_exit_code == 0 && !probe_stdout.trim().is_empty()
}

fn diff_opts(ignore_whitespace: bool, force_text: bool) -> Vec<String> {
	let mut o = Vec::new();
	if ignore_whitespace {
		o.push("-w".to_string());
	}
	if force_text {
		o.push("--text".to_string());
	}
	o
}

/// `git diff <selector>^1 <selector> -- <path>`: the stashed change to a tracked
/// file, against what `HEAD` was when it was stashed.
///
/// Not `git stash show -p <path>` — that command takes no pathspec at all
/// ("Too many revisions specified"), which is what makes this the long way round.
pub fn tracked_diff_args(
	selector: &str,
	path: &str,
	ignore_whitespace: bool,
	force_text: bool,
) -> Vec<String> {
	let mut args = vec!["diff".to_string()];
	args.extend(diff_opts(ignore_whitespace, force_text));
	args.push(format!("{selector}^1"));
	args.push(selector.to_string());
	args.push("--".into());
	args.push(path.to_string());
	args
}

/// `git show --format= --patch <selector>^3 -- <path>` for a file that was
/// untracked when stashed.
///
/// It lives only in the untracked commit, which has no parent — so `show` renders
/// it as the whole file being added, which is exactly what it is.
pub fn untracked_diff_args(
	selector: &str,
	path: &str,
	ignore_whitespace: bool,
	force_text: bool,
) -> Vec<String> {
	let mut args =
		vec!["show".to_string(), "--format=".to_string(), "--patch".to_string()];
	args.extend(diff_opts(ignore_whitespace, force_text));
	args.push(format!("{selector}^3"));
	args.push("--".into());
	args.push(path.to_string());
	args
}

/// `git stash pop|apply <selector>`.
///
/// Two commands rather than one with a flag, because they differ in the thing
/// that matters: `pop` drops the stash once it lands, `apply` keeps it. Git
/// itself keeps a popped stash if the merge conflicted, which is the behaviour to
/// leave alone rather than paper over.
pub fn restore_args(selector: &str, pop: bool) -> Vec<String> {
	vec![
		"stash".into(),
		if pop { "pop".into() } else { "apply".to_string() },
		selector.to_string(),
	]
}

/// `git stash push -u [-m <message>]`.
///
/// An empty message means none is passed at all, so git writes its own
/// "WIP on <branch>: <sha> <subject>" — which is more useful than an empty one.
pub fn push_args(message: &str) -> Vec<String> {
	let mut args = vec!["stash".to_string(), "push".into(), "-u".into()];
	if !message.trim().is_empty() {
		args.push("-m".into());
		args.push(message.trim().to_string());
	}
	args
}

/// Stashes the working tree.
///
/// "No local changes to save" comes back as `ok: false` with git's own words
/// rather than as an error: it is an ordinary answer, not a failure.
pub fn stash_push(
	app: &tauri::AppHandle,
	repo_path: &str,
	message: &str,
	run_id: &str,
) -> Result<CommitOutcome, GitError> {
	let args = push_args(message);
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	let o = run_streaming(app, repo_path, &argv, run_id)?;
	let output = combine_output(&o.stdout, &o.stderr);
	Ok(CommitOutcome { ok: o.exit_code == 0, sha: None, output })
}

pub fn stash_files(
	app: &tauri::AppHandle,
	repo_path: &str,
	selector: &str,
) -> Result<Vec<FileChange>, GitError> {
	let args = files_args(selector);
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	let z = run(app, repo_path, &argv)?;
	Ok(dedupe_by_path(parse_name_status(&z)))
}

pub fn stash_file_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	selector: &str,
	path: &str,
	ignore_whitespace: bool,
	force_text: bool,
) -> Result<String, GitError> {
	let probe = untracked_probe_args(selector, path);
	let probe_argv: Vec<&str> = probe.iter().map(String::as_str).collect();
	// 128 is "not a valid object name", i.e. this stash has no untracked commit —
	// an ordinary answer here, not a failure.
	let probe_out = run_capturing(app, repo_path, &probe_argv)?;
	let args = if is_untracked(probe_out.exit_code, &probe_out.stdout) {
		untracked_diff_args(selector, path, ignore_whitespace, force_text)
	} else {
		tracked_diff_args(selector, path, ignore_whitespace, force_text)
	};
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	// A diff of an unchanged path exits 0 with no output; `run_allowing` keeps a
	// non-zero from a genuinely absent path reported rather than swallowed.
	run_allowing(app, repo_path, &argv, &[])
}

/// Applies a stash, optionally dropping it.
///
/// A conflict comes back as `Ok(CommitOutcome { ok: false, .. })` carrying git's
/// own output: it left the working tree half-merged on purpose, and its message
/// is what says so.
pub fn restore_stash(
	app: &tauri::AppHandle,
	repo_path: &str,
	selector: &str,
	pop: bool,
	run_id: &str,
) -> Result<CommitOutcome, GitError> {
	let args = restore_args(selector, pop);
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	let o = run_streaming(app, repo_path, &argv, run_id)?;
	let output = combine_output(&o.stdout, &o.stderr);
	Ok(CommitOutcome { ok: o.exit_code == 0, sha: None, output })
}

#[cfg(test)]
mod tests {
	use super::*;

	/// Without -u, files that were stashed as untracked are simply missing from
	/// the list — a stash the user deliberately took them into would look wrong.
	#[test]
	fn file_list_includes_untracked() {
		assert_eq!(
			files_args("stash@{0}"),
			["stash", "show", "-u", "--name-status", "-z", "stash@{0}"]
		);
	}

	#[test]
	fn tracked_diff_is_against_the_stash_base() {
		assert_eq!(
			tracked_diff_args("stash@{1}", "a.txt", false, false),
			["diff", "stash@{1}^1", "stash@{1}", "--", "a.txt"]
		);
	}

	#[test]
	fn untracked_diff_reads_the_third_parent() {
		assert_eq!(
			untracked_diff_args("stash@{0}", "u.txt", false, false),
			["show", "--format=", "--patch", "stash@{0}^3", "--", "u.txt"]
		);
	}

	#[test]
	fn diff_options_reach_both_routes() {
		assert_eq!(
			tracked_diff_args("s", "p", true, true),
			["diff", "-w", "--text", "s^1", "s", "--", "p"]
		);
		assert_eq!(
			untracked_diff_args("s", "p", true, true),
			["show", "--format=", "--patch", "-w", "--text", "s^3", "--", "p"]
		);
	}

	#[test]
	fn probes_the_untracked_commit_for_one_path() {
		assert_eq!(
			untracked_probe_args("stash@{2}", "u.txt"),
			["ls-tree", "-r", "--name-only", "stash@{2}^3", "--", "u.txt"]
		);
	}

	/// A stash taken without -u has no third parent at all, so the probe fails —
	/// which means "tracked", not "broken".
	#[test]
	fn a_failed_probe_means_tracked() {
		assert!(!is_untracked(128, ""));
	}

	#[test]
	fn an_empty_answer_means_tracked() {
		// `^3` exists (this stash had untracked files) but not this path.
		assert!(!is_untracked(0, "\n"));
	}

	#[test]
	fn a_named_path_means_untracked() {
		assert!(is_untracked(0, "u.txt\n"));
	}

	/// Without -u the untracked files stay in the working tree, so the stash does
	/// not actually put things back the way they were.
	#[test]
	fn stashing_includes_untracked_files() {
		assert_eq!(push_args(""), ["stash", "push", "-u"]);
	}

	#[test]
	fn a_message_is_passed_whole() {
		assert_eq!(
			push_args("wip: retry logic"),
			["stash", "push", "-u", "-m", "wip: retry logic"]
		);
	}

	/// No message at all beats an empty one: git then writes its own
	/// "WIP on <branch>" summary.
	#[test]
	fn a_blank_message_is_omitted() {
		assert_eq!(push_args("   "), ["stash", "push", "-u"]);
	}

	#[test]
	fn pop_and_apply_are_different_commands() {
		assert_eq!(restore_args("stash@{0}", true), ["stash", "pop", "stash@{0}"]);
		assert_eq!(
			restore_args("stash@{0}", false),
			["stash", "apply", "stash@{0}"]
		);
	}
}
