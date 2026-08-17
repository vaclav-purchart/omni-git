//! Branch operations: checkout, create, delete.
//!
//! Every one is streamed (see `git::stream`). Checkout in particular can be slow
//! on a large tree and is the operation most likely to be REFUSED — a dirty
//! working tree, a name collision — and git's refusal is the only thing that
//! explains why, so it has to reach the output panel.

use crate::git::run::{GitError, Outcome};
use crate::git::stream::run_streaming;

/// `git checkout <branch>`.
pub fn checkout_args(target: &str) -> Vec<String> {
	vec!["checkout".into(), target.to_string()]
}

/// `git checkout --track <remote>/<branch>`, which creates a local branch of the
/// same name already tracking the remote one.
///
/// Explicit `--track` rather than relying on git's DWIM (`checkout <branch>`
/// guessing the remote): the DWIM is ambiguous when several remotes carry the same
/// branch, and it fails in ways that are hard to explain.
pub fn checkout_remote_args(remote_ref: &str) -> Vec<String> {
	vec!["checkout".into(), "--track".into(), remote_ref.to_string()]
}

/// `git checkout --detach <commit>`.
///
/// `--detach` is explicit so the intent is unambiguous and git doesn't have to
/// guess whether a name is a branch or a commit.
pub fn checkout_commit_args(commit: &str) -> Vec<String> {
	vec!["checkout".into(), "--detach".into(), commit.to_string()]
}

/// Creates a branch at `start_point`, optionally switching to it.
///
/// `checkout -b` and `branch` rather than one command with a flag, because those
/// are the two things git actually offers and conflating them would mean deciding
/// for the user whether to switch.
pub fn create_branch_args(name: &str, start_point: &str, checkout: bool) -> Vec<String> {
	if checkout {
		vec![
			"checkout".into(),
			"-b".into(),
			name.to_string(),
			start_point.to_string(),
		]
	} else {
		vec!["branch".into(), name.to_string(), start_point.to_string()]
	}
}

/// `-d` refuses to delete a branch whose commits aren't merged anywhere; `-D`
/// does it anyway. Keeping them separate means the safe one is the default and
/// losing commits is always an explicit choice.
pub fn delete_branch_args(name: &str, force: bool) -> Vec<String> {
	vec![
		"branch".into(),
		if force { "-D".into() } else { "-d".into() },
		name.to_string(),
	]
}

/// Deletes a branch on the remote, by pushing an empty ref to it.
pub fn delete_remote_branch_args(remote: &str, branch: &str) -> Vec<String> {
	vec![
		"push".into(),
		"--progress".into(),
		remote.to_string(),
		"--delete".into(),
		branch.to_string(),
	]
}

/// How far a reset unwinds: which of HEAD, the index and the working tree move.
///
/// `Mixed` is git's default and the common case here — dropping a WIP commit while
/// keeping its changes to re-stage. `Hard` also throws away the working tree, so it
/// is the only one that can lose work.
#[derive(Debug, Clone, Copy, serde::Deserialize, specta::Type)]
pub enum ResetMode {
	/// Move HEAD only; changes stay staged.
	Soft,
	/// Move HEAD and the index; changes stay as unstaged edits.
	Mixed,
	/// Move HEAD, the index and the working tree. Discards uncommitted work.
	Hard,
}

impl ResetMode {
	fn flag(self) -> &'static str {
		match self {
			ResetMode::Soft => "--soft",
			ResetMode::Mixed => "--mixed",
			ResetMode::Hard => "--hard",
		}
	}
}

/// `git reset --<mode> <commit>`.
///
/// The mode is always passed explicitly rather than relying on git's default, so
/// what runs matches what the dialog said — and so the git console shows it.
pub fn reset_args(mode: ResetMode, commit: &str) -> Vec<String> {
	vec!["reset".into(), mode.flag().into(), commit.to_string()]
}

pub fn run(
	app: &tauri::AppHandle,
	repo_path: &str,
	args: &[String],
	run_id: &str,
) -> Result<Outcome, GitError> {
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	run_streaming(app, repo_path, &argv, run_id)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn checkout_a_branch() {
		assert_eq!(checkout_args("main"), ["checkout", "main"]);
	}

	/// Explicit --track: git's DWIM is ambiguous when two remotes have the same
	/// branch name.
	#[test]
	fn checkout_remote_tracks_explicitly() {
		assert_eq!(
			checkout_remote_args("origin/feature"),
			["checkout", "--track", "origin/feature"]
		);
	}

	#[test]
	fn checkout_commit_detaches_explicitly() {
		assert_eq!(
			checkout_commit_args("abc1234"),
			["checkout", "--detach", "abc1234"]
		);
	}

	#[test]
	fn create_branch_with_and_without_switching() {
		assert_eq!(
			create_branch_args("feat", "main", true),
			["checkout", "-b", "feat", "main"]
		);
		assert_eq!(
			create_branch_args("feat", "main", false),
			["branch", "feat", "main"]
		);
	}

	/// The safe delete must be the default: `-d` refuses to drop unmerged
	/// commits, `-D` throws them away.
	#[test]
	fn delete_is_safe_unless_forced() {
		assert_eq!(delete_branch_args("feat", false), ["branch", "-d", "feat"]);
		assert_eq!(delete_branch_args("feat", true), ["branch", "-D", "feat"]);
	}

	#[test]
	fn reset_passes_the_mode_explicitly() {
		assert_eq!(
			reset_args(ResetMode::Mixed, "abc1234"),
			["reset", "--mixed", "abc1234"]
		);
		assert_eq!(
			reset_args(ResetMode::Soft, "abc1234"),
			["reset", "--soft", "abc1234"]
		);
		assert_eq!(
			reset_args(ResetMode::Hard, "abc1234"),
			["reset", "--hard", "abc1234"]
		);
	}

	/// Never rely on git's default: what runs must match what the dialog said, and
	/// it has to be visible in the git console.
	#[test]
	fn reset_never_omits_the_mode() {
		for mode in [ResetMode::Soft, ResetMode::Mixed, ResetMode::Hard] {
			let args = reset_args(mode, "abc");
			assert!(
				args.iter().any(|a| a.starts_with("--")),
				"no mode flag in {args:?}"
			);
		}
	}

	#[test]
	fn delete_remote_branch_pushes_a_deletion() {
		assert_eq!(
			delete_remote_branch_args("origin", "feature"),
			["push", "--progress", "origin", "--delete", "feature"]
		);
	}
}
