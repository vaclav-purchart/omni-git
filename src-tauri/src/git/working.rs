use crate::git::changes::FileChange;
use crate::git::run::{run, run_allowing, GitError};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct WorkingStatus {
	pub head: Option<String>,
	pub staged: Vec<FileChange>,
	pub unstaged: Vec<FileChange>,
	pub untracked: Vec<FileChange>,
}

/// Parse `git status --porcelain=v1 -z -uall` output into
/// (staged, unstaged, untracked). `X` = index-vs-HEAD, `Y` = worktree-vs-index.
pub fn parse_working_status(z: &str) -> (Vec<FileChange>, Vec<FileChange>, Vec<FileChange>) {
	let mut staged = Vec::new();
	let mut unstaged = Vec::new();
	let mut untracked = Vec::new();
	let mut it = z.split('\u{0}');
	while let Some(rec) = it.next() {
		if rec.is_empty() {
			continue;
		}
		// rec = "XY PATH"; bytes 0,1 are X,Y; byte 2 is a space; rest is path.
		let bytes = rec.as_bytes();
		if bytes.len() < 4 {
			continue;
		}
		let x = bytes[0] as char;
		let y = bytes[1] as char;
		let path = rec[3..].to_string();
		if x == '?' && y == '?' {
			untracked.push(FileChange { status: "?".to_string(), path });
			continue;
		}
		if x == '!' && y == '!' {
			continue; // ignored
		}
		// Rename/copy carries an extra ORIG path token we must consume + ignore.
		if x == 'R' || x == 'C' {
			let _orig = it.next();
		}
		if x != ' ' {
			staged.push(FileChange { status: x.to_string(), path: path.clone() });
		}
		if y != ' ' {
			unstaged.push(FileChange { status: y.to_string(), path });
		}
	}
	(staged, unstaged, untracked)
}

/// Repo-root-relative paths of the linked worktrees that live INSIDE this
/// repo's working tree (e.g. `.claude/worktrees/review-ext`). Worktrees kept
/// outside the repo — the usual arrangement — yield nothing, and the main
/// worktree is excluded because it equals `toplevel`.
///
/// `Path::strip_prefix` matches whole components, so a sibling directory that
/// merely shares a textual prefix (`/repo-other` next to `/repo`) is correctly
/// not treated as nested. Components are re-joined with `/` because that's what
/// `git status` emits on every platform.
pub fn nested_worktree_paths(toplevel: &Path, worktree_paths: &[PathBuf]) -> Vec<String> {
	worktree_paths
		.iter()
		.filter_map(|wt| wt.strip_prefix(toplevel).ok())
		.map(|rel| {
			rel.components()
				.map(|c| c.as_os_str().to_string_lossy().to_string())
				.collect::<Vec<_>>()
				.join("/")
		})
		.filter(|rel| !rel.is_empty())
		.collect()
}

/// Drops untracked entries that ARE, or live inside, a registered linked
/// worktree.
///
/// Why this matters: git never descends into a nested repository, so it reports
/// the whole worktree as a single directory entry (with a trailing slash) even
/// under `--untracked-files=all`. Running `git add` on such a path does NOT add
/// its contents — it silently records a **gitlink**, i.e. a broken
/// submodule-like reference. Since the working-copy UI puts a Stage button on
/// every untracked row, one click would commit that. These rows therefore never
/// reach the frontend at all.
pub fn drop_nested_worktrees(untracked: Vec<FileChange>, nested: &[String]) -> Vec<FileChange> {
	untracked
		.into_iter()
		.filter(|f| {
			let path = f.path.trim_end_matches('/');
			!nested
				.iter()
				.any(|n| path == n.as_str() || path.starts_with(&format!("{}/", n)))
		})
		.collect()
}

/// Enumerates nested linked worktrees, canonicalizing both sides so a repo
/// reached through a symlink (`/tmp` → `/private/tmp` on macOS) still matches.
///
/// Returns an empty list on any failure: not being able to enumerate worktrees
/// must degrade to "no filtering", never break the whole status view.
fn nested_worktrees(app: &tauri::AppHandle, repo_path: &str) -> Vec<String> {
	let canon = |p: &str| std::fs::canonicalize(p).unwrap_or_else(|_| PathBuf::from(p));
	let Ok(toplevel) = run(app, repo_path, &["rev-parse", "--show-toplevel"]) else {
		return Vec::new();
	};
	let Ok(worktrees) = crate::git::worktrees::list_worktrees(app, repo_path) else {
		return Vec::new();
	};
	let paths: Vec<PathBuf> = worktrees.iter().map(|w| canon(&w.path)).collect();
	nested_worktree_paths(&canon(toplevel.trim()), &paths)
}

pub fn working_status(app: &tauri::AppHandle, repo_path: &str) -> Result<WorkingStatus, GitError> {
	let z = run(
		app,
		repo_path,
		&["status", "--porcelain=v1", "-z", "--untracked-files=all"],
	)?;
	let (staged, unstaged, mut untracked) = parse_working_status(&z);
	// Under `--untracked-files=all` git lists every untracked path individually,
	// so the ONLY way a directory entry appears is a path it refused to descend
	// into — a nested repo. Gating on that keeps the common case free of the two
	// extra git invocations `nested_worktrees` needs. (If the assumption ever
	// fails we simply don't filter, which is today's behaviour.)
	if untracked.iter().any(|f| f.path.ends_with('/')) {
		untracked = drop_nested_worktrees(untracked, &nested_worktrees(app, repo_path));
	}
	let head = run(app, repo_path, &["rev-parse", "HEAD"])
		.ok()
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty());
	Ok(WorkingStatus { head, staged, unstaged, untracked })
}

#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
pub enum WorkingSection {
	Staged,
	Unstaged,
	Untracked,
}

/// Builds the full `git` argv (starting at `"diff"`, ending with the
/// pathspec) for a working-copy diff. Pure and unit-testable without an
/// `AppHandle` — see the `working_diff_args_*` tests below.
pub fn working_diff_args<'a>(
	section: WorkingSection,
	ignore_whitespace: bool,
	force_text: bool,
	path: &'a str,
) -> Vec<&'a str> {
	let mut args: Vec<&str> = vec!["diff", "--no-color"];
	match section {
		WorkingSection::Staged => args.push("--cached"),
		WorkingSection::Unstaged => {}
		WorkingSection::Untracked => args.push("--no-index"),
	}
	if ignore_whitespace {
		args.push("-w");
	}
	// Treat a "binary" file as text on request. Git calls anything with a NUL in
	// its first 8000 bytes binary, which catches source files that merely contain
	// one in a string literal — and for those the text diff is exactly what the
	// user wants to see.
	if force_text {
		args.push("--text");
	}
	match section {
		WorkingSection::Untracked => {
			args.push("--");
			args.push("/dev/null");
			args.push(path);
		}
		_ => {
			args.push("--");
			args.push(path);
		}
	}
	args
}

pub fn working_file_diff(
	app: &tauri::AppHandle,
	repo_path: &str,
	path: &str,
	section: WorkingSection,
	ignore_whitespace: bool,
	force_text: bool,
) -> Result<String, GitError> {
	let args = working_diff_args(section, ignore_whitespace, force_text, path);
	match section {
		// --no-index exits 1 when the files differ (always, here).
		WorkingSection::Untracked => run_allowing(app, repo_path, &args, &[1]),
		_ => run(app, repo_path, &args),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;

	fn untracked_of(paths: &[&str]) -> Vec<FileChange> {
		paths
			.iter()
			.map(|p| FileChange { status: "?".to_string(), path: p.to_string() })
			.collect()
	}

	fn paths_of(files: &[FileChange]) -> Vec<&str> {
		files.iter().map(|f| f.path.as_str()).collect()
	}

	#[test]
	fn nested_worktree_paths_finds_worktrees_inside_the_repo() {
		let top = PathBuf::from("/repo");
		let worktrees = vec![
			PathBuf::from("/repo"),                          // the main worktree
			PathBuf::from("/repo/.claude/worktrees/review"),  // nested
			PathBuf::from("/elsewhere/wt"),                   // outside the repo
		];

		assert_eq!(
			nested_worktree_paths(&top, &worktrees),
			vec![".claude/worktrees/review".to_string()],
			"only worktrees nested inside the repo, and never the main one"
		);
	}

	/// A textual `starts_with` would wrongly call `/repo-other` nested inside
	/// `/repo`; `Path::strip_prefix` matches whole components.
	#[test]
	fn nested_worktree_paths_ignores_sibling_with_shared_prefix() {
		let worktrees = vec![PathBuf::from("/repo-other/wt")];

		assert!(nested_worktree_paths(&PathBuf::from("/repo"), &worktrees).is_empty());
	}

	#[test]
	fn drop_nested_worktrees_removes_the_worktree_dir_and_its_contents() {
		let untracked = untracked_of(&[
			"notes.md",
			".claude/worktrees/review/",
			".claude/worktrees/review/src/main.rs",
			".claude/worktrees-notes.txt",
		]);

		let kept = drop_nested_worktrees(untracked, &[".claude/worktrees/review".to_string()]);

		assert_eq!(
			paths_of(&kept),
			vec!["notes.md", ".claude/worktrees-notes.txt"],
			"the worktree dir and anything under it go; a same-prefix sibling stays"
		);
	}

	#[test]
	fn drop_nested_worktrees_keeps_everything_when_there_are_no_worktrees() {
		let untracked = untracked_of(&["a.txt", "dir/"]);

		let kept = drop_nested_worktrees(untracked, &[]);

		assert_eq!(paths_of(&kept), vec!["a.txt", "dir/"]);
	}

	/// The real-world regression (reported on `finshape/configurator`, which
	/// keeps `.claude/worktrees/<name>` inside itself): against actual git,
	/// prove BOTH halves of the premise — that a nested linked worktree really
	/// does surface as an untracked *directory* entry even under
	/// `--untracked-files=all`, and that our filter removes it. If a future git
	/// changed the first half, this test fails loudly instead of the filter
	/// quietly doing nothing.
	#[test]
	fn nested_linked_worktree_is_reported_untracked_and_gets_filtered() {
		fn git(dir: &std::path::Path, args: &[&str]) {
			Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
		}

		let d = tempfile::tempdir().unwrap();
		let p = std::fs::canonicalize(d.path()).unwrap();
		git(&p, &["init", "-q", "-b", "main"]);
		git(&p, &["config", "user.email", "t@e.st"]);
		git(&p, &["config", "user.name", "T"]);
		std::fs::write(p.join("f.txt"), "a\n").unwrap();
		git(&p, &["add", "."]);
		git(&p, &["commit", "-qm", "base"]);
		std::fs::write(p.join("loose.txt"), "untracked\n").unwrap();
		git(&p, &["worktree", "add", "--detach", "-q", ".claude/worktrees/review", "HEAD"]);

		let out = Command::new("git")
			.arg("-C")
			.arg(&p)
			.args(["status", "--porcelain=v1", "-z", "--untracked-files=all"])
			.output()
			.unwrap();
		let (_staged, _unstaged, untracked) =
			parse_working_status(&String::from_utf8_lossy(&out.stdout));

		assert!(
			untracked.iter().any(|f| f.path == ".claude/worktrees/review/"),
			"premise: git reports the nested worktree as a directory entry; got {:?}",
			paths_of(&untracked)
		);

		let wt_out = Command::new("git")
			.arg("-C")
			.arg(&p)
			.args(["worktree", "list", "--porcelain"])
			.output()
			.unwrap();
		let worktrees = crate::git::worktrees::parse_worktrees(&String::from_utf8_lossy(
			&wt_out.stdout,
		));
		let canon: Vec<PathBuf> = worktrees
			.iter()
			.map(|w| std::fs::canonicalize(&w.path).unwrap_or_else(|_| PathBuf::from(&w.path)))
			.collect();
		let nested = nested_worktree_paths(&p, &canon);
		assert_eq!(nested, vec![".claude/worktrees/review".to_string()]);

		let kept = drop_nested_worktrees(untracked, &nested);

		assert_eq!(
			paths_of(&kept),
			vec!["loose.txt"],
			"the worktree is gone, genuinely untracked files remain"
		);
	}

	#[test]
	fn splits_staged_unstaged_untracked() {
		// M  staged-only ; " M" unstaged-only ; "MM" both ; "A " added-staged ;
		// " D" deleted-unstaged ; "R " rename (with orig) ; "??" untracked
		let z = "M  a.txt\u{0} M b.txt\u{0}MM c.txt\u{0}A  d.txt\u{0} D e.txt\u{0}R  new.txt\u{0}old.txt\u{0}?? u.txt\u{0}";
		let (staged, unstaged, untracked) = parse_working_status(z);
		let sp: Vec<_> = staged.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
		let up: Vec<_> = unstaged.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
		let tp: Vec<_> = untracked.iter().map(|f| (f.status.as_str(), f.path.as_str())).collect();
		assert_eq!(sp, vec![("M", "a.txt"), ("M", "c.txt"), ("A", "d.txt"), ("R", "new.txt")]);
		assert_eq!(up, vec![("M", "b.txt"), ("M", "c.txt"), ("D", "e.txt")]);
		assert_eq!(tp, vec![("?", "u.txt")]);
	}

	fn git(dir: &std::path::Path, args: &[&str]) {
		std::process::Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
	}

	fn git_output(dir: &std::path::Path, args: &[&str]) -> std::process::Output {
		std::process::Command::new("git").arg("-C").arg(dir).args(args).output().unwrap()
	}

	#[test]
	fn working_diff_sections_route_correctly() {
		// These fns need an AppHandle (unavailable in unit tests), so we shell
		// out directly, mirroring exactly the args production builds, and
		// assert at the git level (same approach as `compare.rs`'s tests).
		let tmp = tempfile::tempdir().unwrap();
		let dir = tmp.path();
		git(dir, &["init", "-q", "-b", "main"]);
		git(dir, &["config", "user.email", "t@t"]);
		git(dir, &["config", "user.name", "t"]);
		std::fs::write(dir.join("staged.txt"), "hello\nworld\n").unwrap();
		std::fs::write(dir.join("unstaged.txt"), "foo\nbar\n").unwrap();
		std::fs::write(dir.join("indent.txt"), "hello\nworld\n").unwrap();
		git(dir, &["add", "."]);
		git(dir, &["commit", "-qm", "base"]);

		// Staged: modify + stage.
		std::fs::write(dir.join("staged.txt"), "hello\nchanged\n").unwrap();
		git(dir, &["add", "staged.txt"]);

		// Unstaged: modify, do not stage.
		std::fs::write(dir.join("unstaged.txt"), "foo\nchanged\n").unwrap();

		// Untracked: new file, never added.
		std::fs::write(dir.join("untracked.txt"), "brand new\n").unwrap();

		// Indent-only change, unstaged, to exercise `-w`.
		std::fs::write(dir.join("indent.txt"), "\thello\n\tworld\n").unwrap();

		let staged_diff = git_output(dir, &["diff", "--cached", "--", "staged.txt"]);
		assert!(!staged_diff.stdout.is_empty(), "staged diff must be non-empty");

		let unstaged_diff = git_output(dir, &["diff", "--", "unstaged.txt"]);
		assert!(!unstaged_diff.stdout.is_empty(), "unstaged diff must be non-empty");

		let untracked_diff = Command::new("git")
			.arg("-C")
			.arg(dir)
			.args(["diff", "--no-color", "--no-index", "--", "/dev/null", "untracked.txt"])
			.output()
			.unwrap();
		// --no-index exits 1 when the files differ; that's expected, not an error.
		assert_eq!(untracked_diff.status.code(), Some(1));
		let untracked_stdout = String::from_utf8_lossy(&untracked_diff.stdout);
		assert!(!untracked_stdout.is_empty(), "untracked diff must be non-empty");
		assert!(
			untracked_stdout.lines().any(|l| l.starts_with('+') && !l.starts_with("+++")),
			"untracked diff must contain +-added lines"
		);

		// Counterfactual: without -w, the SAME indent-only edit must produce a
		// non-empty diff -- otherwise the "with -w it's empty" assertion above
		// would be vacuously true even if -w had no effect at all.
		let indent_diff_no_w = git_output(dir, &["diff", "--", "indent.txt"]);
		assert!(
			!indent_diff_no_w.stdout.is_empty(),
			"without -w, the whitespace-only re-indent must produce a non-empty patch"
		);

		let indent_diff = git_output(dir, &["diff", "-w", "--", "indent.txt"]);
		assert!(
			indent_diff.stdout.is_empty(),
			"with -w, a whitespace-only re-indent must produce an empty patch"
		);
	}

	#[test]
	fn working_diff_args_staged() {
		assert_eq!(
			working_diff_args(WorkingSection::Staged, false, false, "a.txt"),
			vec!["diff", "--no-color", "--cached", "--", "a.txt"]
		);
		assert_eq!(
			working_diff_args(WorkingSection::Staged, true, false, "a.txt"),
			vec!["diff", "--no-color", "--cached", "-w", "--", "a.txt"]
		);
	}

	#[test]
	fn working_diff_args_unstaged() {
		assert_eq!(
			working_diff_args(WorkingSection::Unstaged, false, false, "a.txt"),
			vec!["diff", "--no-color", "--", "a.txt"]
		);
		assert_eq!(
			working_diff_args(WorkingSection::Unstaged, true, false, "a.txt"),
			vec!["diff", "--no-color", "-w", "--", "a.txt"]
		);
	}

	#[test]
	fn working_diff_args_untracked() {
		assert_eq!(
			working_diff_args(WorkingSection::Untracked, false, false, "a.txt"),
			vec!["diff", "--no-color", "--no-index", "--", "/dev/null", "a.txt"]
		);
		assert_eq!(
			working_diff_args(WorkingSection::Untracked, true, false, "a.txt"),
			vec!["diff", "--no-color", "--no-index", "-w", "--", "/dev/null", "a.txt"]
		);
	}

	/// A source file with a NUL in a string literal is "binary" to git, so its
	/// diff is unreadable until --text is passed. It must land BEFORE the
	/// pathspec, like every other option.
	#[test]
	fn working_diff_args_force_text_adds_text_before_the_pathspec() {
		for section in [
			WorkingSection::Staged,
			WorkingSection::Unstaged,
			WorkingSection::Untracked,
		] {
			let args = working_diff_args(section, false, true, "f.txt");
			let text = args.iter().position(|a| *a == "--text").expect("--text present");
			let dashdash = args.iter().position(|a| *a == "--").expect("-- present");
			assert!(text < dashdash, "--text must precede the pathspec: {:?}", args);
		}
	}

	#[test]
	fn working_diff_args_omits_text_unless_asked() {
		let args = working_diff_args(WorkingSection::Unstaged, false, false, "f.txt");

		assert!(!args.contains(&"--text"), "got {:?}", args);
	}

	#[test]
	fn working_diff_args_untracked_dev_null_immediately_before_path_after_dashdash() {
		// Guards against a future swap of the /dev/null / path order, or of
		// -w's position relative to "--", in the Untracked match arm.
		for ignore_whitespace in [false, true] {
			let args = working_diff_args(WorkingSection::Untracked, ignore_whitespace, false, "new.txt");
			let dashdash = args.iter().position(|a| *a == "--").expect("must contain --");
			assert_eq!(args[dashdash + 1], "/dev/null", "/dev/null must come right after --");
			assert_eq!(args[dashdash + 2], "new.txt", "path must come right after /dev/null");
			assert_eq!(args.len(), dashdash + 3, "nothing must follow path");
			if ignore_whitespace {
				let w_pos = args.iter().position(|a| *a == "-w").expect("-w must be present");
				assert!(w_pos < dashdash, "-w must sit before --");
				assert!(w_pos > 0, "-w must come after the mode flags");
			}
		}
	}

	#[test]
	fn working_diff_args_w_position_all_sections() {
		// -w, when present, must sit after the mode flags (--cached/--no-index)
		// and before "--", in every section.
		for section in [WorkingSection::Staged, WorkingSection::Unstaged, WorkingSection::Untracked] {
			let args = working_diff_args(section, true, false, "f.txt");
			let dashdash = args.iter().position(|a| *a == "--").expect("must contain --");
			let w_pos = args.iter().position(|a| *a == "-w").expect("-w must be present");
			assert!(w_pos < dashdash, "-w must come before --");
			assert!(w_pos >= 2, "-w must come after \"diff\", \"--no-color\", and any mode flag");
		}
	}
}
