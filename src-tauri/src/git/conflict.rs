//! What the repo is in the middle of, and which files are blocking it.
//!
//! A conflicted repo is a mode: half the normal actions will refuse, the working
//! tree holds files with conflict markers in them, and the way out is one of
//! continue / abort / skip. Not saying so is how people end up staring at a
//! branch that won't do anything.
//!
//! Detection reads the same marker files git's own shell prompt reads. There is
//! no porcelain command that answers "what am I in the middle of" — `git status`
//! says it in prose, which is not something to parse.

use crate::git::commit::{CommitOutcome, combine_output};
use crate::git::run::{GitError, run, run_allowing};
use crate::git::stream::run_streaming;
use serde::Serialize;

// Both directions: reported to the UI, and passed back when the user picks
// continue/abort/skip.
#[derive(
	Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, specta::Type,
)]
pub enum OperationKind {
	Merge,
	Rebase,
	CherryPick,
	Revert,
	/// `git am` — a patch series being applied.
	Apply,
}

impl OperationKind {
	/// The git subcommand that continues, aborts or skips it.
	pub fn command(self) -> &'static str {
		match self {
			OperationKind::Merge => "merge",
			OperationKind::Rebase => "rebase",
			OperationKind::CherryPick => "cherry-pick",
			OperationKind::Revert => "revert",
			OperationKind::Apply => "am",
		}
	}

	/// Whether `--skip` means anything. A merge is a single step, so there is no
	/// "next one" to move on to.
	pub fn can_skip(self) -> bool {
		!matches!(self, OperationKind::Merge)
	}
}

/// Which marker files exist in the git directory. Separated from the filesystem
/// so the precedence rules below are testable.
#[derive(Debug, Clone, Copy, Default)]
pub struct Markers {
	pub merge_head: bool,
	pub cherry_pick_head: bool,
	pub revert_head: bool,
	pub rebase_merge: bool,
	/// `rebase-apply/`, used by both `rebase --apply` and `git am`.
	pub rebase_apply: bool,
	/// `rebase-apply/applying`, which is what distinguishes `am` from a rebase.
	pub applying: bool,
}

/// Precedence matters. A rebase that stops on a conflict leaves no `MERGE_HEAD`
/// (verified), but a cherry-pick run BY a rebase leaves `CHERRY_PICK_HEAD` while
/// the rebase is what is actually in progress — so the rebase markers are checked
/// first, and telling the user "cherry-pick" there would send them to the wrong
/// `--abort`.
pub fn detect(m: Markers) -> Option<OperationKind> {
	if m.rebase_merge {
		return Some(OperationKind::Rebase);
	}
	if m.rebase_apply {
		return Some(if m.applying {
			OperationKind::Apply
		} else {
			OperationKind::Rebase
		});
	}
	if m.merge_head {
		return Some(OperationKind::Merge);
	}
	if m.cherry_pick_head {
		return Some(OperationKind::CherryPick);
	}
	if m.revert_head {
		return Some(OperationKind::Revert);
	}
	None
}

/// "3/7" progress, from the counter files a rebase keeps.
pub fn parse_step(msgnum: &str, end: &str) -> Option<(u32, u32)> {
	let a = msgnum.trim().parse().ok()?;
	let b = end.trim().parse().ok()?;
	Some((a, b))
}

/// `refs/heads/feature` → `feature`. Left alone if it isn't a branch ref.
pub fn short_head_name(raw: &str) -> String {
	raw.trim().trim_start_matches("refs/heads/").to_string()
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RepoOperation {
	/// None when nothing is in progress, which is the normal case.
	pub kind: Option<OperationKind>,
	/// Paths git reports as unmerged. Empty during an operation that has stopped
	/// for another reason (a failing hook, an `edit` step in an interactive
	/// rebase), which is itself worth showing.
	pub conflicts: Vec<String>,
	/// Rebase progress, as (current, total).
	pub step: Option<(u32, u32)>,
	/// The branch being rebased, when there is one.
	pub head_name: Option<String>,
	pub can_skip: bool,
}

impl RepoOperation {
	pub fn none() -> Self {
		Self {
			kind: None,
			conflicts: Vec::new(),
			step: None,
			head_name: None,
			can_skip: false,
		}
	}
}

/// `git diff --name-only --diff-filter=U -z`: the unmerged paths.
pub fn conflicts_args() -> Vec<String> {
	vec![
		"diff".into(),
		"--name-only".into(),
		"--diff-filter=U".into(),
		"-z".into(),
	]
}

pub fn parse_conflicts(z: &str) -> Vec<String> {
	z.split('\u{0}')
		.filter(|s| !s.is_empty())
		.map(str::to_string)
		.collect()
}

/// `git <op> --continue|--abort|--skip`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, specta::Type)]
pub enum OperationAction {
	Continue,
	Abort,
	Skip,
}

pub fn action_args(kind: OperationKind, action: OperationAction) -> Vec<String> {
	let flag = match action {
		OperationAction::Continue => "--continue",
		OperationAction::Abort => "--abort",
		OperationAction::Skip => "--skip",
	};
	vec![kind.command().to_string(), flag.to_string()]
}

fn read_marker(git_dir: &std::path::Path, name: &str) -> bool {
	git_dir.join(name).exists()
}

fn read_file(git_dir: &std::path::Path, name: &str) -> Option<String> {
	std::fs::read_to_string(git_dir.join(name)).ok()
}

/// Reads what the repo is in the middle of.
///
/// Cheap enough to run on every refresh: one `rev-parse`, a handful of `exists`
/// calls, and a `diff` that only touches the index.
pub fn repo_operation(
	app: &tauri::AppHandle,
	repo_path: &str,
) -> Result<RepoOperation, GitError> {
	// --absolute-git-dir, so this is right inside a linked worktree too, where
	// `.git` is a file pointing elsewhere.
	let git_dir = run(app, repo_path, &["rev-parse", "--absolute-git-dir"])?;
	let git_dir = std::path::Path::new(git_dir.trim());

	let markers = Markers {
		merge_head: read_marker(git_dir, "MERGE_HEAD"),
		cherry_pick_head: read_marker(git_dir, "CHERRY_PICK_HEAD"),
		revert_head: read_marker(git_dir, "REVERT_HEAD"),
		rebase_merge: read_marker(git_dir, "rebase-merge"),
		rebase_apply: read_marker(git_dir, "rebase-apply"),
		applying: read_marker(git_dir, "rebase-apply/applying"),
	};
	let Some(kind) = detect(markers) else {
		return Ok(RepoOperation::none());
	};

	let args = conflicts_args();
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	// A repo mid-operation can have an unreadable index for a moment; an error
	// here should degrade to "no conflicts listed", not hide the operation.
	let conflicts = run_allowing(app, repo_path, &argv, &[])
		.map(|z| parse_conflicts(&z))
		.unwrap_or_default();

	let dir = if markers.rebase_merge {
		"rebase-merge"
	} else {
		"rebase-apply"
	};
	let step = match (
		read_file(git_dir, &format!("{dir}/msgnum")),
		read_file(git_dir, &format!("{dir}/end")),
	) {
		(Some(a), Some(b)) => parse_step(&a, &b),
		// `rebase-apply` and `git am` count with next/last instead.
		_ => match (
			read_file(git_dir, &format!("{dir}/next")),
			read_file(git_dir, &format!("{dir}/last")),
		) {
			(Some(a), Some(b)) => parse_step(&a, &b),
			_ => None,
		},
	};
	let head_name = read_file(git_dir, &format!("{dir}/head-name"))
		.map(|raw| short_head_name(&raw))
		.filter(|s| !s.is_empty());

	Ok(RepoOperation {
		kind: Some(kind),
		conflicts,
		step,
		head_name,
		can_skip: kind.can_skip(),
	})
}

/// Continues, aborts or skips whatever is in progress.
///
/// A refusal — usually "you still have unmerged files" — comes back as
/// `ok: false` with git's own words, which name the files still in the way.
pub fn run_action(
	app: &tauri::AppHandle,
	repo_path: &str,
	kind: OperationKind,
	action: OperationAction,
	run_id: &str,
) -> Result<CommitOutcome, GitError> {
	let args = action_args(kind, action);
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	let o = run_streaming(app, repo_path, &argv, run_id)?;
	let output = combine_output(&o.stdout, &o.stderr);
	Ok(CommitOutcome { ok: o.exit_code == 0, sha: None, output })
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn nothing_in_progress() {
		assert_eq!(detect(Markers::default()), None);
	}

	#[test]
	fn a_merge_is_detected() {
		let m = Markers { merge_head: true, ..Default::default() };
		assert_eq!(detect(m), Some(OperationKind::Merge));
	}

	#[test]
	fn a_rebase_is_detected() {
		let m = Markers { rebase_merge: true, ..Default::default() };
		assert_eq!(detect(m), Some(OperationKind::Rebase));
	}

	/// `rebase-apply` without `applying` is the old-style rebase, not `git am`.
	#[test]
	fn rebase_apply_without_applying_is_a_rebase() {
		let m = Markers { rebase_apply: true, ..Default::default() };
		assert_eq!(detect(m), Some(OperationKind::Rebase));
	}

	#[test]
	fn applying_marks_it_as_am() {
		let m = Markers { rebase_apply: true, applying: true, ..Default::default() };
		assert_eq!(detect(m), Some(OperationKind::Apply));
	}

	/// A rebase runs cherry-picks internally and leaves CHERRY_PICK_HEAD behind
	/// while the REBASE is what is actually in progress. Reporting the wrong one
	/// sends the user to a `--abort` that does something else entirely.
	#[test]
	fn a_rebase_outranks_the_cherry_pick_it_is_running() {
		let m = Markers {
			rebase_merge: true,
			cherry_pick_head: true,
			..Default::default()
		};
		assert_eq!(detect(m), Some(OperationKind::Rebase));
	}

	#[test]
	fn cherry_pick_and_revert_are_distinguished() {
		let cp = Markers { cherry_pick_head: true, ..Default::default() };
		let rv = Markers { revert_head: true, ..Default::default() };
		assert_eq!(detect(cp), Some(OperationKind::CherryPick));
		assert_eq!(detect(rv), Some(OperationKind::Revert));
	}

	/// A merge is one step, so there is nothing to skip TO.
	#[test]
	fn only_multi_step_operations_can_skip() {
		assert!(!OperationKind::Merge.can_skip());
		assert!(OperationKind::Rebase.can_skip());
		assert!(OperationKind::CherryPick.can_skip());
	}

	#[test]
	fn each_kind_maps_to_its_own_subcommand() {
		assert_eq!(
			action_args(OperationKind::Rebase, OperationAction::Continue),
			["rebase", "--continue"]
		);
		assert_eq!(
			action_args(OperationKind::Merge, OperationAction::Abort),
			["merge", "--abort"]
		);
		assert_eq!(
			action_args(OperationKind::CherryPick, OperationAction::Skip),
			["cherry-pick", "--skip"]
		);
		assert_eq!(
			action_args(OperationKind::Revert, OperationAction::Continue),
			["revert", "--continue"]
		);
		assert_eq!(
			action_args(OperationKind::Apply, OperationAction::Abort),
			["am", "--abort"]
		);
	}

	#[test]
	fn conflicts_are_nul_separated() {
		assert_eq!(
			parse_conflicts("a.txt\u{0}dir/b.txt\u{0}"),
			["a.txt", "dir/b.txt"]
		);
		assert!(parse_conflicts("").is_empty());
	}

	/// A path with a newline in it is why -z is used at all.
	#[test]
	fn a_newline_in_a_path_survives() {
		assert_eq!(parse_conflicts("we\nird.txt\u{0}"), ["we\nird.txt"]);
	}

	#[test]
	fn progress_is_read_from_the_counters() {
		assert_eq!(parse_step("3\n", "7\n"), Some((3, 7)));
		assert_eq!(parse_step("", "7"), None);
		assert_eq!(parse_step("x", "7"), None);
	}

	#[test]
	fn the_branch_name_loses_its_ref_prefix() {
		assert_eq!(short_head_name("refs/heads/feature\n"), "feature");
		// A detached rebase records something else; leave it alone rather than
		// mangling it.
		assert_eq!(short_head_name("detached HEAD\n"), "detached HEAD");
	}
}
