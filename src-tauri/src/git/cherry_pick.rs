//! Cherry-picking commits onto whatever is checked out.
//!
//! Two modes, because both are things people actually want: commit each pick as
//! it lands, or apply the changes and leave them staged (`--no-commit`) so they
//! can be reviewed, amended, or squashed into one commit by hand.
//!
//! A conflict is NOT unwound here. `git cherry-pick` stops and leaves
//! `CHERRY_PICK_HEAD` in place, which is the state that lets the conflict be
//! resolved and `--continue`d; aborting on the user's behalf would throw away
//! whatever it managed to apply. Git's own output says exactly that, and it
//! reaches the output panel intact.

use crate::git::commit::{CommitOutcome, combine_output};
use crate::git::run::{GitError, Outcome, run_capturing};
use crate::git::stream::run_streaming;

/// `git cherry-pick [-n] [-m 1] <commit>...`
///
/// `-m 1` picks the first parent's side of a merge, i.e. "the changes this merge
/// brought in relative to the branch it landed on", which is the only sense in
/// which cherry-picking a merge means anything. It has to be passed for every
/// commit in the run or none, since git takes one mainline for the whole
/// invocation — see `needs_mainline`.
pub fn cherry_pick_args(
	commits: &[String],
	no_commit: bool,
	mainline: bool,
) -> Vec<String> {
	let mut args = vec!["cherry-pick".to_string()];
	if no_commit {
		args.push("--no-commit".into());
	}
	if mainline {
		args.push("-m".into());
		args.push("1".into());
	}
	args.extend(commits.iter().cloned());
	args
}

/// Reverses the log's newest-first order into the order the picks must be
/// applied.
///
/// Cherry-picking a run of commits only reproduces the original sequence if the
/// oldest goes first; applied newest-first, each pick would be trying to build on
/// changes that are not there yet, and a run that should apply cleanly conflicts
/// instead.
pub fn apply_order(newest_first: &[String]) -> Vec<String> {
	newest_first.iter().rev().cloned().collect()
}

/// `git rev-list --parents -n 1 <commit>`, whose one line is
/// "<commit> <parent>..." — so the parent count is the field count minus one.
pub fn parents_args(commit: &str) -> Vec<String> {
	vec![
		"rev-list".into(),
		"--parents".into(),
		"-n".into(),
		"1".into(),
		commit.to_string(),
	]
}

pub fn count_parents(stdout: &str) -> usize {
	stdout
		.split_whitespace()
		.count()
		.saturating_sub(1)
}

/// Whether the run needs `-m 1`.
///
/// Git takes ONE mainline for the whole invocation, so a selection containing any
/// merge needs it. Passing it alongside ordinary commits is fine: git accepts
/// `-m` on a non-merge (checked against git 2.50). This was first written to
/// REFUSE a mixed selection on the assumption that git rejects that — it does
/// not, and refusing would have blocked a perfectly workable pick.
///
/// One invocation rather than one per commit, deliberately: git's sequencer then
/// owns the whole run, so a conflict part-way can be resolved and `--continue`d
/// through the rest.
pub fn needs_mainline(is_merge: &[bool]) -> bool {
	is_merge.iter().any(|m| *m)
}

fn parent_count(
	app: &tauri::AppHandle,
	repo_path: &str,
	commit: &str,
) -> Result<usize, GitError> {
	let args = parents_args(commit);
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	let o: Outcome = run_capturing(app, repo_path, &argv)?;
	if o.exit_code != 0 {
		return Err(GitError::NonZero { code: o.exit_code, stderr: o.stderr });
	}
	Ok(count_parents(&o.stdout))
}

/// Cherry-picks `commits` (given newest-first, as the log shows them).
///
/// A conflict, or any other refusal by git, comes back as
/// `Ok(CommitOutcome { ok: false, .. })` carrying git's own output rather than as
/// an `Err` — for cherry-pick especially, that output is the instructions for
/// getting out again.
pub fn cherry_pick(
	app: &tauri::AppHandle,
	repo_path: &str,
	commits: &[String],
	no_commit: bool,
	run_id: &str,
) -> Result<CommitOutcome, GitError> {
	if commits.is_empty() {
		return Ok(CommitOutcome { ok: false, sha: None, output: String::new() });
	}
	let mut is_merge = Vec::with_capacity(commits.len());
	for c in commits {
		is_merge.push(parent_count(app, repo_path, c)? > 1);
	}
	let args =
		cherry_pick_args(&apply_order(commits), no_commit, needs_mainline(&is_merge));
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

	#[test]
	fn picks_and_commits_by_default() {
		assert_eq!(
			cherry_pick_args(&["abc".into()], false, false),
			["cherry-pick", "abc"]
		);
	}

	#[test]
	fn no_commit_leaves_the_changes_staged() {
		assert_eq!(
			cherry_pick_args(&["abc".into()], true, false),
			["cherry-pick", "--no-commit", "abc"]
		);
	}

	#[test]
	fn a_merge_needs_a_mainline() {
		assert_eq!(
			cherry_pick_args(&["abc".into()], false, true),
			["cherry-pick", "-m", "1", "abc"]
		);
	}

	#[test]
	fn passes_every_commit_in_one_invocation() {
		assert_eq!(
			cherry_pick_args(&["a".into(), "b".into(), "c".into()], false, false),
			["cherry-pick", "a", "b", "c"]
		);
	}

	/// The log shows newest first; applied in that order each pick would build on
	/// changes that have not landed yet, so a run that should apply cleanly would
	/// conflict instead.
	#[test]
	fn applies_oldest_first() {
		let newest_first = ["c3".to_string(), "c2".to_string(), "c1".to_string()];

		assert_eq!(apply_order(&newest_first), ["c1", "c2", "c3"]);
	}

	#[test]
	fn a_single_commit_needs_no_reordering() {
		assert_eq!(apply_order(&["only".to_string()]), ["only"]);
	}

	#[test]
	fn counts_parents_from_rev_list() {
		assert_eq!(count_parents("sha parent\n"), 1);
		assert_eq!(count_parents("sha p1 p2\n"), 2);
		// A root commit has none.
		assert_eq!(count_parents("sha\n"), 0);
		assert_eq!(count_parents(""), 0);
	}

	#[test]
	fn ordinary_commits_need_no_mainline() {
		assert!(!needs_mainline(&[false, false]));
		// A root commit has no parents, and is not a merge either.
		assert!(!needs_mainline(&[false]));
	}

	#[test]
	fn a_merge_anywhere_in_the_run_needs_one() {
		assert!(needs_mainline(&[true]));
		assert!(needs_mainline(&[true, true]));
	}

	/// A mixed selection is NOT refused. This started out as one, on the
	/// assumption that git rejects `-m` for a non-merge commit — checked against
	/// git 2.50, which accepts it, so refusing would have blocked a selection that
	/// works perfectly well.
	#[test]
	fn a_mix_of_merges_and_ordinary_commits_still_runs() {
		assert!(needs_mainline(&[true, false]));
		assert!(needs_mainline(&[false, true, false]));
	}
}
