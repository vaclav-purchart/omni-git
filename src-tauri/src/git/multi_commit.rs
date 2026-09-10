//! The combined changes of several selected commits.
//!
//! Git has no single command for "the diff of this arbitrary set of commits".
//! `A^..B` only means anything for a contiguous, linear run, and a selection made
//! by Cmd-clicking scattered rows is neither — the range would silently include
//! commits the user did not pick.
//!
//! So each commit is asked for its own changes and the results are combined:
//! the FILE LIST is the union of the paths touched, and a file's DIFF is each
//! commit's patch for it in turn, oldest first, labelled with the commit it came
//! from. That is correct for any selection, and it keeps the attribution — which
//! a squashed range diff throws away, and which is most of what you want when
//! reading several commits at once.

use crate::git::changes::{FileChange, commit_files, file_diff};
use crate::git::run::{GitError, run};

/// Newest-first (as the log shows them) into oldest-first, which is the order
/// changes actually happened in and so the order to read them in.
pub fn oldest_first(newest_first: &[String]) -> Vec<String> {
	newest_first.iter().rev().cloned().collect()
}

/// Merges per-commit file lists into one, keeping the first appearance of each
/// path.
///
/// A path touched by several of the commits is ONE row: the panel lists files,
/// not (file, commit) pairs, and its diff below shows every commit's take on it.
/// The status kept is the earliest one, so a file added and later modified still
/// reads as added by this run of commits.
pub fn merge_files(per_commit: Vec<Vec<FileChange>>) -> Vec<FileChange> {
	let mut seen = std::collections::HashSet::new();
	let mut out = Vec::new();
	for files in per_commit {
		for f in files {
			if seen.insert(f.path.clone()) {
				out.push(f);
			}
		}
	}
	out
}

/// The label that separates one commit's patch from the next.
///
/// A plain context line: the diff renderer classifies anything that is not
/// `+`/`-` as context, so this shows up as an ordinary line rather than breaking
/// the parse.
pub fn section_header(short_hash: &str, subject: &str) -> String {
	format!("──── {short_hash}  {subject}")
}

pub fn commits_files(
	app: &tauri::AppHandle,
	repo_path: &str,
	commits: &[String],
) -> Result<Vec<FileChange>, GitError> {
	let mut per_commit = Vec::with_capacity(commits.len());
	for hash in oldest_first(commits) {
		per_commit.push(commit_files(app, repo_path, &hash)?);
	}
	Ok(merge_files(per_commit))
}

fn subject_of(
	app: &tauri::AppHandle,
	repo_path: &str,
	hash: &str,
) -> Result<String, GitError> {
	let s = run(app, repo_path, &["log", "-1", "--pretty=%s", hash, "--"])?;
	Ok(s.trim().to_string())
}

/// Every selected commit's patch for `path`, oldest first.
///
/// Commits that did not touch the file are skipped rather than emitting an empty
/// section — a run of headers with nothing under them says nothing.
pub fn commits_file_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	commits: &[String],
	path: &str,
	ignore_whitespace: bool,
	force_text: bool,
) -> Result<String, GitError> {
	let mut sections: Vec<String> = Vec::new();
	for hash in oldest_first(commits) {
		let patch = file_diff(app, repo_path, &hash, path, ignore_whitespace, force_text)?;
		if patch.trim().is_empty() {
			continue;
		}
		let subject = subject_of(app, repo_path, &hash).unwrap_or_default();
		sections.push(format!(
			"{}\n{}",
			section_header(&hash[..hash.len().min(7)], &subject),
			patch.trim_end()
		));
	}
	Ok(sections.join("\n\n"))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn f(status: &str, path: &str) -> FileChange {
		FileChange { status: status.into(), path: path.into() }
	}

	/// The log shows newest first, but changes happened oldest first — which is
	/// the order they have to be read in for the result to make sense.
	#[test]
	fn commits_are_read_oldest_first() {
		let newest_first = ["c3".to_string(), "c2".to_string(), "c1".to_string()];

		assert_eq!(oldest_first(&newest_first), ["c1", "c2", "c3"]);
	}

	#[test]
	fn files_from_every_commit_appear() {
		let merged = merge_files(vec![vec![f("M", "a.rs")], vec![f("A", "b.rs")]]);

		assert_eq!(
			merged.iter().map(|x| x.path.as_str()).collect::<Vec<_>>(),
			["a.rs", "b.rs"]
		);
	}

	/// The panel lists FILES, not (file, commit) pairs: a path touched by three of
	/// the selected commits is still one row, whose diff shows all three.
	#[test]
	fn a_path_touched_twice_is_listed_once() {
		let merged = merge_files(vec![
			vec![f("A", "a.rs")],
			vec![f("M", "a.rs"), f("M", "b.rs")],
		]);

		assert_eq!(merged.len(), 2);
		assert_eq!(merged[0].path, "a.rs");
	}

	/// Earliest status wins: a file this run of commits ADDED and later edited
	/// was, as far as the run is concerned, added.
	#[test]
	fn the_earliest_status_is_kept() {
		let merged = merge_files(vec![vec![f("A", "a.rs")], vec![f("M", "a.rs")]]);

		assert_eq!(merged[0].status, "A");
	}

	#[test]
	fn an_empty_selection_has_no_files() {
		assert!(merge_files(vec![]).is_empty());
	}

	/// Not a `+`/`-` line, so the diff renderer treats it as context instead of
	/// counting it as an added line or failing to parse the patch that follows.
	#[test]
	fn the_section_header_is_an_ordinary_context_line() {
		let h = section_header("abc1234", "fix: the thing");

		assert!(!h.starts_with('+'));
		assert!(!h.starts_with('-'));
		assert!(h.contains("abc1234"));
		assert!(h.contains("fix: the thing"));
	}
}
