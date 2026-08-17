use crate::git::changes::{dedupe_by_path, parse_name_status, FileChange};
use crate::git::run::{run, GitError};

/// Best-effort default base branch: origin/HEAD's target, else main/master/develop.
pub fn default_branch(app: &tauri::AppHandle, repo_path: &str) -> Option<String> {
	if let Ok(out) = run(
		app,
		repo_path,
		&["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
	) {
		let name = out.trim();
		if !name.is_empty() {
			return Some(name.to_string());
		}
	}
	for candidate in ["main", "master", "develop"] {
		if run(app, repo_path, &["rev-parse", "--verify", "--quiet", candidate]).is_ok() {
			return Some(candidate.to_string());
		}
	}
	None
}

/// Pure: given (candidate_name, commits_head_is_ahead_of_the_merge_base) pairs,
/// pick the candidate head most recently diverged from = smallest positive
/// ahead-count. `preferred` (the default branch) breaks ties. None if no
/// candidate has a positive ahead-count.
pub fn pick_fork_base(
	candidates: &[(String, u32)],
	preferred: Option<&str>,
) -> Option<String> {
	candidates
		.iter()
		.filter(|(_, ahead)| *ahead > 0)
		.min_by(|a, b| {
			a.1.cmp(&b.1).then_with(|| {
				let pa = preferred == Some(a.0.as_str());
				let pb = preferred == Some(b.0.as_str());
				// prefer the preferred branch on a tie
				pb.cmp(&pa)
			})
		})
		.map(|(name, _)| name.clone())
}

/// Small set of branches a feature is realistically forked from — the default
/// branch plus common mainline names (local + origin). Keeps fork_base to a
/// handful of git calls instead of one per branch (was multi-second on repos
/// with many branches).
fn base_candidates(app: &tauri::AppHandle, repo_path: &str, head: &str) -> Vec<String> {
	let mut cands: Vec<String> = Vec::new();
	if let Some(d) = default_branch(app, repo_path) {
		cands.push(d);
	}
	for name in [
		"main",
		"master",
		"develop",
		"origin/main",
		"origin/master",
		"origin/develop",
	] {
		cands.push(name.to_string());
	}
	cands.sort();
	cands.dedup();
	cands.retain(|c| c != head);
	cands
}

pub fn fork_base(app: &tauri::AppHandle, repo_path: &str, head: &str) -> Option<String> {
	let preferred = default_branch(app, repo_path);
	let mut ranked: Vec<(String, u32)> = Vec::new();
	for cand in base_candidates(app, repo_path, head) {
		let mb = match run(app, repo_path, &["merge-base", &cand, head]) {
			Ok(s) => s.trim().to_string(),
			Err(_) => continue,
		};
		if mb.is_empty() {
			continue;
		}
		let range = format!("{}..{}", mb, head);
		let ahead = run(app, repo_path, &["rev-list", "--count", &range])
			.ok()
			.and_then(|s| s.trim().parse::<u32>().ok())
			.unwrap_or(0);
		ranked.push((cand, ahead));
	}
	pick_fork_base(&ranked, preferred.as_deref()).or(preferred)
}

/// Builds the three-dot range string used for branch comparisons: net changes
/// on `head` since it diverged from `base` (excludes changes merged in from
/// `base`). Kept as a pure function so tests can assert the exact dot-count
/// used by production without needing an `AppHandle`.
pub fn three_dot_range(base: &str, head: &str) -> String {
	format!("{}...{}", base, head)
}

/// The revision a comparison diffs *against*, and whether the right-hand side is
/// the working tree or a commit.
///
/// `include_worktree` asks for "everything this branch has done, including what
/// isn't committed yet". That is only meaningful when `head` is the branch that
/// is actually checked out — the working tree belongs to whatever HEAD is, so
/// folding it into a comparison of some OTHER branch would attribute your local
/// edits to a branch that has never seen them.
///
/// Reviewing a branch with uncommitted work and being shown the pre-edit state is
/// actively misleading: a line you have since deleted still reads as one you
/// added.
pub fn diff_target(
	app: &tauri::AppHandle,
	repo_path: &str,
	base: &str,
	head: &str,
	include_worktree: bool,
) -> Result<String, GitError> {
	if !include_worktree {
		return Ok(three_dot_range(base, head));
	}
	// `git diff <commit>` compares that commit to the WORKING TREE, staged and
	// unstaged alike. There is no range syntax for it: `base...` would resolve its
	// empty right-hand side to HEAD, giving the committed state again.
	let mb = run(app, repo_path, &["merge-base", base, head])?;
	let mb = mb.trim();
	if mb.is_empty() {
		return Ok(three_dot_range(base, head));
	}
	Ok(mb.to_string())
}

/// Net changes on `head` since it diverged from `base` (excluding changes merged
/// in from `base`), optionally including the working tree — see `diff_target`.
pub fn branch_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	base: &str,
	head: &str,
	include_worktree: bool,
) -> Result<Vec<FileChange>, GitError> {
	let range = diff_target(app, repo_path, base, head, include_worktree)?;
	let z = run(
		app,
		repo_path,
		&["diff", "--no-color", "--name-status", "-r", "-z", &range],
	)?;
	Ok(dedupe_by_path(parse_name_status(&z)))
}

pub fn branch_file_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	base: &str,
	head: &str,
	path: &str,
	ignore_whitespace: bool,
	force_text: bool,
	include_worktree: bool,
) -> Result<String, GitError> {
	let range = diff_target(app, repo_path, base, head, include_worktree)?;
	let mut args = vec!["diff", "--no-color"];
	if ignore_whitespace {
		args.push("-w");
	}
	if force_text {
		args.push("--text");
	}
	args.push(&range);
	args.push("--");
	args.push(path);
	run(app, repo_path, &args)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;

	fn git(dir: &std::path::Path, args: &[&str]) {
		Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
	}

	#[test]
	fn range_uses_three_dots() {
		assert_eq!(three_dot_range("main", "feature"), "main...feature");
	}

	#[test]
	fn dash_w_hides_indent_only_change() {
		// Build a repo where `head` re-indents a line vs `base` with no
		// textual change. Locks the `-w` contract that `branch_file_diff`
		// relies on: `branch_file_diff` needs an `AppHandle` (unavailable in
		// unit tests), so we shell out directly, mirroring how production
		// builds the args.
		let tmp = tempfile::tempdir().unwrap();
		let dir = tmp.path();
		git(dir, &["init", "-q", "-b", "main"]);
		git(dir, &["config", "user.email", "t@t"]);
		git(dir, &["config", "user.name", "t"]);
		std::fs::write(dir.join("f.txt"), "hello\nworld\n").unwrap();
		git(dir, &["add", "."]);
		git(dir, &["commit", "-qm", "base"]);
		git(dir, &["checkout", "-q", "-b", "feat"]);
		// Same text, only leading whitespace added.
		std::fs::write(dir.join("f.txt"), "\thello\n\tworld\n").unwrap();
		git(dir, &["add", "."]);
		git(dir, &["commit", "-qm", "reindent"]);

		let range = three_dot_range("main", "feat");

		let without_w = Command::new("git")
			.arg("-C")
			.arg(dir)
			.args(["diff", "--no-color", &range, "--", "f.txt"])
			.output()
			.unwrap();
		let with_w = Command::new("git")
			.arg("-C")
			.arg(dir)
			.args(["diff", "--no-color", "-w", &range, "--", "f.txt"])
			.output()
			.unwrap();

		assert!(
			!without_w.stdout.is_empty(),
			"without -w, the re-indent must show up as a diff"
		);
		assert!(
			with_w.stdout.is_empty(),
			"with -w, a whitespace-only re-indent must produce an empty patch"
		);
	}

	/// THE REPORTED BUG: a line deleted in the working tree but not yet committed
	/// still read as a line the branch ADDED, because the comparison only ever
	/// looked at commits. Reviewing your own branch has to show your own edits.
	#[test]
	fn comparing_your_own_branch_includes_uncommitted_work() {
		let d = tempfile::tempdir().unwrap();
		let p = d.path();
		git(p, &["init", "-q", "-b", "main"]);
		git(p, &["config", "user.email", "t@t"]);
		git(p, &["config", "user.name", "T"]);
		std::fs::write(p.join("f.txt"), "keep\ndelete-me\n").unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-qm", "base"]);
		git(p, &["checkout", "-q", "-b", "feature"]);
		std::fs::write(p.join("f.txt"), "keep\ndelete-me\nadded\n").unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-qm", "branch work"]);
		// The uncommitted deletion.
		std::fs::write(p.join("f.txt"), "keep\nadded\n").unwrap();

		let committed_only = patch(p, &three_dot_range("main", "feature"));
		assert!(
			!committed_only.contains("-delete-me"),
			"sanity: the commit-only range cannot see the uncommitted deletion"
		);

		let mb = merge_base(p, "main", "feature");
		let with_worktree = patch(p, &mb);

		assert!(
			with_worktree.contains("-delete-me"),
			"the uncommitted deletion must show as a deletion, not be missing"
		);
		assert!(
			with_worktree.contains("+added"),
			"the branch's committed work must still be there too"
		);
	}

	/// Staged and unstaged alike: `git diff <commit>` spans both.
	#[test]
	fn staged_changes_are_included_too() {
		let d = tempfile::tempdir().unwrap();
		let p = d.path();
		git(p, &["init", "-q", "-b", "main"]);
		git(p, &["config", "user.email", "t@t"]);
		git(p, &["config", "user.name", "T"]);
		std::fs::write(p.join("f.txt"), "one\n").unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-qm", "base"]);
		git(p, &["checkout", "-q", "-b", "feature"]);
		std::fs::write(p.join("f.txt"), "two\n").unwrap();
		git(p, &["add", "f.txt"]);

		let mb = merge_base(p, "main", "feature");

		assert!(patch(p, &mb).contains("+two"));
	}

	fn merge_base(dir: &std::path::Path, a: &str, b: &str) -> String {
		let out = Command::new("git")
			.arg("-C")
			.arg(dir)
			.args(["merge-base", a, b])
			.output()
			.unwrap();
		String::from_utf8_lossy(&out.stdout).trim().to_string()
	}

	fn patch(dir: &std::path::Path, target: &str) -> String {
		let out = Command::new("git")
			.arg("-C")
			.arg(dir)
			.args(["diff", "--no-color", target, "--", "f.txt"])
			.output()
			.unwrap();
		String::from_utf8_lossy(&out.stdout).to_string()
	}

	fn diff_paths(dir: &std::path::Path, range: &str) -> Vec<String> {
		let z = Command::new("git")
			.arg("-C")
			.arg(dir)
			.args(["diff", "--name-status", "-r", "-z", range])
			.output()
			.unwrap();
		dedupe_by_path(parse_name_status(&String::from_utf8_lossy(&z.stdout)))
			.into_iter()
			.map(|f| f.path)
			.collect()
	}

	// Builds a DIVERGED topology (no merge back): base has A; feature branches
	// off, adds B and edits A; base then commits a third file C that feature
	// never sees. merge-base(main, feature) == the initial "base" commit, which
	// is strictly behind both tips, so two-dot and three-dot genuinely differ
	// here — proving the three-dot assertion below is not a tautology.
	fn repo() -> tempfile::TempDir {
		let d = tempfile::tempdir().unwrap();
		let p = d.path();
		git(p, &["init", "-b", "main"]);
		git(p, &["config", "user.email", "t@e.st"]);
		git(p, &["config", "user.name", "T"]);
		std::fs::write(p.join("a.txt"), "a1\n").unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-m", "base"]);
		git(p, &["checkout", "-b", "feature"]);
		std::fs::write(p.join("b.txt"), "b1\n").unwrap();
		std::fs::write(p.join("a.txt"), "a2\n").unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-m", "feature work"]);
		git(p, &["checkout", "main"]);
		std::fs::write(p.join("c.txt"), "c1\n").unwrap();
		git(p, &["add", "."]);
		git(p, &["commit", "-m", "main-only change"]);
		// Deliberately no merge: main and feature stay diverged.
		d
	}

	#[test]
	fn three_dot_excludes_diverged_base_changes() {
		let d = repo();
		let path = d.path();

		// Three-dot (production range, built via the shared helper): compares
		// feature's tree against the merge-base, so it must contain feature's
		// own changes and must NOT contain main-only c.txt.
		let three_dot = three_dot_range("main", "feature");
		let three_dot_paths = diff_paths(path, &three_dot);
		assert!(
			three_dot_paths.iter().any(|p| p == "b.txt"),
			"feature's added file present in three-dot diff"
		);
		assert!(
			three_dot_paths.iter().any(|p| p == "a.txt"),
			"feature's edit present in three-dot diff"
		);
		assert!(
			!three_dot_paths.iter().any(|p| p == "c.txt"),
			"main-only change must be excluded from three-dot diff"
		);

		// Two-dot: compares main's tree directly against feature's tree, so
		// main-only c.txt DOES show up (as a deletion, since it's absent from
		// feature). This proves the topology is genuinely diverged and that
		// the three-dot exclusion above is meaningful, not a tautology.
		let two_dot_paths = diff_paths(path, "main..feature");
		assert!(
			two_dot_paths.iter().any(|p| p == "c.txt"),
			"two-dot diff must include main-only c.txt, proving two-dot and \
			 three-dot genuinely differ for this topology"
		);
	}
}

#[cfg(test)]
mod fork_tests {
	use super::*;

	#[test]
	fn picks_nearest_diverged_candidate() {
		// feature forked from develop (ahead 1); develop forked from main (so
		// main's merge-base with feature is older → larger ahead-count).
		let ranked = vec![("main".to_string(), 3), ("develop".to_string(), 1)];
		assert_eq!(pick_fork_base(&ranked, Some("main")).as_deref(), Some("develop"));
	}

	#[test]
	fn tie_prefers_default() {
		let ranked = vec![("main".to_string(), 2), ("other".to_string(), 2)];
		assert_eq!(pick_fork_base(&ranked, Some("main")).as_deref(), Some("main"));
	}

	#[test]
	fn none_when_no_positive_ahead() {
		let ranked = vec![("main".to_string(), 0)];
		assert_eq!(pick_fork_base(&ranked, None), None);
	}
}
