use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct FileChange {
	pub status: String,
	pub path: String,
}

/// Parses `git diff-tree --name-status -r -z` output: NUL-separated tokens
/// alternating status, path (rename/copy statuses emit status, old, new).
pub fn parse_name_status(z: &str) -> Vec<FileChange> {
	let mut out = Vec::new();
	let mut it = z.split('\u{0}').filter(|s| !s.is_empty());
	while let Some(status) = it.next() {
		let code = status.chars().next().unwrap_or('?');
		if code == 'R' || code == 'C' {
			// old path then new path; keep the new path.
			let _old = it.next();
			if let Some(new_path) = it.next() {
				out.push(FileChange {
					status: code.to_string(),
					path: new_path.to_string(),
				});
			}
		} else if let Some(path) = it.next() {
			out.push(FileChange {
				status: code.to_string(),
				path: path.to_string(),
			});
		}
	}
	out
}

/// Deduplicates file changes by path, keeping the first occurrence.
/// With `-m`, diff-tree can emit the same path once per parent.
pub fn dedupe_by_path(changes: Vec<FileChange>) -> Vec<FileChange> {
	let mut seen = std::collections::HashSet::new();
	changes
		.into_iter()
		.filter(|c| seen.insert(c.path.clone()))
		.collect()
}

pub fn commit_files(
	app: &tauri::AppHandle,
	repo_path: &str,
	hash: &str,
) -> Result<Vec<FileChange>, GitError> {
	// `-m --first-parent` makes merge commits list their (first-parent) diff
	// instead of nothing; `--root` handles the initial commit.
	let z = run(
		app,
		repo_path,
		&[
			"diff-tree",
			"--no-commit-id",
			"--name-status",
			"-r",
			"-z",
			"-m",
			"--first-parent",
			"--root",
			hash,
		],
	)?;
	Ok(dedupe_by_path(parse_name_status(&z)))
}

pub fn file_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	hash: &str,
	path: &str,
	ignore_whitespace: bool,
	force_text: bool,
) -> Result<String, GitError> {
	// `show --format=` suppresses the commit header, leaving just the patch
	// for this path. `--` disambiguates the pathspec.
	let mut args = vec!["show", "--format=", "--patch"];
	if ignore_whitespace {
		args.push("-w");
	}
	if force_text {
		args.push("--text");
	}
	args.push(hash);
	args.push("--");
	args.push(path);
	run(app, repo_path, &args)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_add_modify_delete() {
		let z = "A\u{0}new.txt\u{0}M\u{0}changed.rs\u{0}D\u{0}gone.md\u{0}";
		let out = parse_name_status(z);
		assert_eq!(out.len(), 3);
		assert_eq!(out[0].status, "A");
		assert_eq!(out[0].path, "new.txt");
		assert_eq!(out[2].status, "D");
		assert_eq!(out[2].path, "gone.md");
	}

	#[test]
	fn rename_keeps_new_path() {
		let z = "R100\u{0}old/name.rs\u{0}new/name.rs\u{0}";
		let out = parse_name_status(z);
		assert_eq!(out.len(), 1);
		assert_eq!(out[0].status, "R");
		assert_eq!(out[0].path, "new/name.rs");
	}

	#[test]
	fn dedupes_repeated_paths_from_m_output() {
		// With -m, diff-tree can emit the same path once per parent.
		let z = "M\u{0}same.rs\u{0}M\u{0}same.rs\u{0}A\u{0}new.rs\u{0}";
		let out = super::dedupe_by_path(super::parse_name_status(z));
		assert_eq!(out.len(), 2);
		assert_eq!(out[0].path, "same.rs");
		assert_eq!(out[1].path, "new.rs");
	}
}
