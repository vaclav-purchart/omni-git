//! Merging a branch into the checked-out one.
//!
//! A conflict is NOT unwound here. `git merge` stops with the conflicting files
//! left in the working tree, which is the state you resolve from; aborting on the
//! user's behalf would throw that away. Git's own output says what happened and
//! names `--abort`, and it reaches the output panel intact.

use crate::git::commit::{CommitOutcome, combine_output};
use crate::git::run::{GitError, run_capturing};
use crate::git::stream::run_streaming;

/// How the merge should land.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, specta::Type)]
pub enum MergeMode {
	/// `--no-ff`: always record a merge commit, even when a fast-forward was
	/// possible, so the branch's shape survives in the history.
	Commit,
	/// Git's default: fast-forward when the current branch hasn't diverged,
	/// otherwise make a merge commit.
	FastForward,
	/// `--squash`: apply the result as staged changes with no commit and no merge
	/// recorded, to be committed by hand as one.
	Squash,
}

/// `git merge [--no-ff|--ff|--squash] [--no-commit] <target>`.
///
/// The mode is always passed explicitly rather than relying on git's default or
/// on `merge.ff` config, so what runs matches what the dialog said — and so the
/// git console shows it.
///
/// `--squash` implies no commit, but `--no-commit` is passed alongside it anyway:
/// the two together are what makes "leave it staged" unambiguous to anyone
/// reading the console, and git accepts the pair.
pub fn merge_args(target: &str, mode: MergeMode) -> Vec<String> {
	let mut args = vec!["merge".to_string()];
	match mode {
		MergeMode::Commit => args.push("--no-ff".into()),
		MergeMode::FastForward => args.push("--ff".into()),
		MergeMode::Squash => {
			args.push("--squash".into());
			args.push("--no-commit".into());
		}
	}
	args.push(target.to_string());
	args
}

/// Merges `target` into whatever is checked out.
///
/// A conflict, or any other refusal, comes back as
/// `Ok(CommitOutcome { ok: false, .. })` carrying git's own output rather than as
/// an `Err` — for a merge that output is also the instructions for getting out.
pub fn merge(
	app: &tauri::AppHandle,
	repo_path: &str,
	target: &str,
	mode: MergeMode,
	run_id: &str,
) -> Result<CommitOutcome, GitError> {
	let args = merge_args(target, mode);
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	let o = run_streaming(app, repo_path, &argv, run_id)?;
	let output = combine_output(&o.stdout, &o.stderr);
	if o.exit_code != 0 {
		return Ok(CommitOutcome { ok: false, sha: None, output });
	}
	let head = run_capturing(app, repo_path, &["rev-parse", "HEAD"])?;
	Ok(CommitOutcome {
		ok: true,
		sha: Some(head.stdout.trim().to_string()),
		output,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	/// Explicit --no-ff: without it a merge that COULD fast-forward silently
	/// wouldn't record the merge at all, which is the opposite of what picking
	/// "merge commit" asked for.
	#[test]
	fn a_merge_commit_is_forced() {
		assert_eq!(
			merge_args("feature", MergeMode::Commit),
			["merge", "--no-ff", "feature"]
		);
	}

	/// Explicit --ff rather than nothing: `merge.ff` config could otherwise turn
	/// this into something else entirely.
	#[test]
	fn fast_forward_is_asked_for_explicitly() {
		assert_eq!(
			merge_args("feature", MergeMode::FastForward),
			["merge", "--ff", "feature"]
		);
	}

	#[test]
	fn squash_leaves_the_changes_staged() {
		assert_eq!(
			merge_args("feature", MergeMode::Squash),
			["merge", "--squash", "--no-commit", "feature"]
		);
	}

	/// The ref is one argv element, so a branch name with a slash — or anything
	/// else a shell would have opinions about — arrives whole.
	#[test]
	fn the_target_is_one_argument() {
		let args = merge_args("feature/JIRA-1 retry", MergeMode::Commit);

		assert_eq!(args.last().unwrap(), "feature/JIRA-1 retry");
	}
}
