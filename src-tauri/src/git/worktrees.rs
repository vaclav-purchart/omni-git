use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct Worktree {
	pub path: String,
	pub branch: Option<String>,
	pub is_detached: bool,
}

// `git worktree list --porcelain`: records separated by blank lines, each with
// "worktree <path>", optional "branch refs/heads/<name>" or "detached".
pub fn parse_worktrees(stdout: &str) -> Vec<Worktree> {
	let mut out = Vec::new();
	let mut path: Option<String> = None;
	let mut branch: Option<String> = None;
	let mut detached = false;
	let flush = |path: &mut Option<String>, branch: &mut Option<String>, detached: &mut bool, out: &mut Vec<Worktree>| {
		if let Some(p) = path.take() {
			out.push(Worktree {
				path: p,
				branch: branch.take(),
				is_detached: *detached,
			});
		}
		*detached = false;
	};
	for line in stdout.lines() {
		if let Some(p) = line.strip_prefix("worktree ") {
			flush(&mut path, &mut branch, &mut detached, &mut out);
			path = Some(p.to_string());
		} else if let Some(b) = line.strip_prefix("branch ") {
			branch = Some(b.trim_start_matches("refs/heads/").to_string());
		} else if line.trim() == "detached" {
			detached = true;
		}
	}
	flush(&mut path, &mut branch, &mut detached, &mut out);
	out
}

pub fn list_worktrees(app: &tauri::AppHandle, repo_path: &str) -> Result<Vec<Worktree>, GitError> {
	let out = run(app, repo_path, &["worktree", "list", "--porcelain"])?;
	Ok(parse_worktrees(&out))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_main_and_linked_worktree() {
		let out = "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo-wt\nHEAD def\ndetached\n";
		let wts = parse_worktrees(out);
		assert_eq!(wts.len(), 2);
		assert_eq!(wts[0].path, "/repo");
		assert_eq!(wts[0].branch.as_deref(), Some("main"));
		assert!(!wts[0].is_detached);
		assert_eq!(wts[1].path, "/repo-wt");
		assert_eq!(wts[1].branch, None);
		assert!(wts[1].is_detached);
	}
}
