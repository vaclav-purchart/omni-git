//! Changing the message of a commit that is already made.
//!
//! For `HEAD` this is just `git commit --amend`. For anything older there is no
//! such thing as editing a commit: a commit's hash covers its message, so
//! changing the message MAKES A NEW COMMIT, and every descendant — which records
//! its parent's hash — has to be rebuilt on top of it. That is history rewriting,
//! and the caller is expected to have said so out loud before getting here.
//!
//! The rewrite is done with the portable three-step recipe rather than
//! `rebase --interactive`: detach at the target, amend it there, then replay the
//! branch onto the amended commit. Interactive rebase would mean driving
//! `GIT_SEQUENCE_EDITOR`, which needs a helper program that behaves the same on
//! Windows as on Unix — there isn't one.
//!
//! The replay cannot conflict. Amending only the message leaves the tree
//! byte-identical, so every descendant applies to exactly the state it was
//! written against. What CAN fail is the amend itself (a `commit-msg` hook), and
//! that is why every failure path restores the branch it started on.

use crate::git::commit::{CommitOutcome, combine_output};
use crate::git::run::{GitError, Outcome, run_capturing};

/// `git commit --amend --only --allow-empty -m <message>`.
///
/// `--only` is what makes this a reword rather than an amend. A plain
/// `commit --amend` commits the current index, so rewording `HEAD` while
/// anything was staged would silently sweep those changes into the commit —
/// a menu item called "Reword message" must not touch the tree. With `--only`
/// and no paths, the commit keeps its existing tree and the index is left alone.
///
/// `--allow-empty` because `--only` otherwise refuses with "No changes" on a
/// commit that has none — rewording an empty commit is unusual but perfectly
/// legitimate, and it would fail for a reason that has nothing to do with the
/// message.
pub fn amend_message_args(message: &str) -> Vec<String> {
	vec![
		"commit".into(),
		"--amend".into(),
		"--only".into(),
		"--allow-empty".into(),
		"-m".into(),
		message.to_string(),
	]
}

/// `git checkout --detach <commit>`.
pub fn detach_args(commit: &str) -> Vec<String> {
	vec!["checkout".into(), "--detach".into(), commit.to_string()]
}

/// The first git release with `rebase --update-refs`.
const UPDATE_REFS_SINCE: (u32, u32) = (2, 38);

/// Parses the `major.minor` out of `git --version` output.
///
/// Tolerates the vendor suffixes real builds carry ("2.50.1 (Apple Git-155)",
/// "2.39.5.windows.1"), because a version this can't read must not silently cost
/// the user `--update-refs`.
pub fn parse_version(version: &str) -> Option<(u32, u32)> {
	let numeric = version.trim().trim_start_matches("git version ");
	let mut parts = numeric.split(['.', ' ', '-']).filter(|p| !p.is_empty());
	let major = parts.next()?.parse().ok()?;
	let minor = parts.next()?.parse().ok()?;
	Some((major, minor))
}

pub fn supports_update_refs(version: Option<(u32, u32)>) -> bool {
	version.is_some_and(|v| v >= UPDATE_REFS_SINCE)
}

/// `git rebase --rebase-merges [--update-refs] --onto <new_base> <upstream> <branch>`.
///
/// Replays `<upstream>..<branch>` onto `<new_base>` and leaves `<branch>`
/// checked out.
///
/// `--rebase-merges` because the default flattens merge commits into a linear
/// sequence. Rewording one message is no reason to silently reshape the graph.
///
/// `--update-refs` moves any OTHER local branch that pointed into the rewritten
/// range. Without it those branches keep pointing at the original commits, so the
/// history visibly forks — the reworded commit on one branch, its unreworded twin
/// still reachable from another. Gated on the git version because the flag only
/// exists from 2.38; on older git the rewrite still succeeds, it just leaves the
/// other branches behind. Tags are never moved either way, and that is correct:
/// a tag is a promise about a specific commit.
pub fn rebase_onto_args(
	new_base: &str,
	upstream: &str,
	branch: &str,
	update_refs: bool,
) -> Vec<String> {
	let mut args = vec!["rebase".to_string(), "--rebase-merges".to_string()];
	if update_refs {
		args.push("--update-refs".into());
	}
	args.push("--onto".into());
	args.push(new_base.to_string());
	args.push(upstream.to_string());
	args.push(branch.to_string());
	args
}

/// `git rebase --abort`, for unwinding a replay that stopped part-way.
pub fn rebase_abort_args() -> Vec<String> {
	vec!["rebase".into(), "--abort".into()]
}

/// Whether `ancestor` is reachable from `descendant`.
///
/// Exit code 0 means yes, 1 means no — 1 is a real answer here, not a failure,
/// so the caller reads the code rather than treating non-zero as an error.
pub fn is_ancestor_args(ancestor: &str, descendant: &str) -> Vec<String> {
	vec![
		"merge-base".into(),
		"--is-ancestor".into(),
		ancestor.to_string(),
		descendant.to_string(),
	]
}

/// Why a reword can't be attempted. Each maps to something the user has to fix
/// first, so they are distinct rather than one generic string.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
	/// No branch is checked out, so there is nothing to replay the descendants
	/// onto.
	DetachedHead,
	/// The commit isn't reachable from `HEAD`, so it isn't on the current branch
	/// and this branch's history doesn't contain it to rewrite.
	NotOnCurrentBranch,
	/// Rebase refuses to run with modified tracked files, and finding that out
	/// half-way through would leave the repo detached.
	DirtyWorkingTree,
}

impl Refusal {
	pub fn message(&self) -> &'static str {
		match self {
			Refusal::DetachedHead => {
				"HEAD is detached. Check out a branch before rewording a commit on it."
			}
			Refusal::NotOnCurrentBranch => {
				"That commit isn't on the current branch, so rewording it here would \
				 have nothing to rebuild. Check out the branch that contains it first."
			}
			Refusal::DirtyWorkingTree => {
				"Rewording an earlier commit rebuilds the ones after it, which needs a \
				 clean working tree. Commit or stash your changes first."
			}
		}
	}
}

/// Decides whether the working tree is clean enough to rebase.
///
/// Untracked files are deliberately ignored: rebase doesn't care about them, and
/// refusing over a stray build artefact would be obstructive. Hence
/// `--untracked-files=no` rather than filtering `??` lines out afterwards, which
/// would also have to understand renames and quoting.
pub fn dirty_check_args() -> Vec<String> {
	vec!["status".into(), "--porcelain".into(), "--untracked-files=no".into()]
}

/// What `reword` needs to know about the repo before it can act. Split out so the
/// decision is testable without a git repo.
#[derive(Debug, Clone)]
pub struct RewordContext {
	pub branch: Option<String>,
	pub head_sha: String,
	pub target_sha: String,
	pub target_is_ancestor: bool,
	pub tree_dirty: bool,
}

/// The three possible shapes of the job, decided before anything is written.
#[derive(Debug, PartialEq, Eq)]
pub enum Plan {
	/// The target is `HEAD`: a plain amend, no rewriting of anything else.
	AmendHead,
	/// The target is older: detach, amend, replay `branch` on top.
	Rewrite { branch: String },
	Refused(Refusal),
}

pub fn plan(ctx: &RewordContext) -> Plan {
	// Checked before the branch requirement: amending HEAD works perfectly well
	// with a detached HEAD, and refusing would be a lie.
	if ctx.target_sha == ctx.head_sha {
		return Plan::AmendHead;
	}
	let Some(branch) = ctx.branch.clone() else {
		return Plan::Refused(Refusal::DetachedHead);
	};
	if !ctx.target_is_ancestor {
		return Plan::Refused(Refusal::NotOnCurrentBranch);
	}
	// Last, so a commit that could never be reworded says so rather than sending
	// the user off to stash first and then refusing anyway.
	if ctx.tree_dirty {
		return Plan::Refused(Refusal::DirtyWorkingTree);
	}
	Plan::Rewrite { branch }
}

fn step(
	app: &tauri::AppHandle,
	repo_path: &str,
	args: &[String],
	log: &mut Vec<String>,
) -> Result<Outcome, GitError> {
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	let o = run_capturing(app, repo_path, &argv)?;
	let text = combine_output(&o.stdout, &o.stderr);
	if !text.is_empty() {
		log.push(text);
	}
	Ok(o)
}

fn rev_parse(
	app: &tauri::AppHandle,
	repo_path: &str,
	rev: &str,
) -> Result<String, GitError> {
	let o = run_capturing(app, repo_path, &["rev-parse", rev])?;
	if o.exit_code != 0 {
		return Err(GitError::NonZero { code: o.exit_code, stderr: o.stderr });
	}
	Ok(o.stdout.trim().to_string())
}

/// Reads everything `plan` needs.
pub fn context(
	app: &tauri::AppHandle,
	repo_path: &str,
	commit: &str,
) -> Result<RewordContext, GitError> {
	// --quiet so a detached HEAD is exit code 1 and an empty answer rather than a
	// message on stderr that would look like a failure in the console.
	let branch_out =
		run_capturing(app, repo_path, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
	let branch = if branch_out.exit_code == 0 {
		let name = branch_out.stdout.trim().to_string();
		(!name.is_empty()).then_some(name)
	} else {
		None
	};
	let head_sha = rev_parse(app, repo_path, "HEAD")?;
	let target_sha = rev_parse(app, repo_path, commit)?;
	let ancestor_args = is_ancestor_args(&target_sha, &head_sha);
	let argv: Vec<&str> = ancestor_args.iter().map(String::as_str).collect();
	let target_is_ancestor = run_capturing(app, repo_path, &argv)?.exit_code == 0;
	let dirty = dirty_check_args();
	let argv: Vec<&str> = dirty.iter().map(String::as_str).collect();
	let tree_dirty = !run_capturing(app, repo_path, &argv)?.stdout.trim().is_empty();
	Ok(RewordContext { branch, head_sha, target_sha, target_is_ancestor, tree_dirty })
}

/// Rewords `commit` to `message`.
///
/// A refusal by git — a hook rejecting the new message, a rebase that stops —
/// comes back as `Ok(CommitOutcome { ok: false, .. })` carrying git's own output,
/// not as an `Err`, for the same reason `commit` does it: the command's output is
/// the only thing that explains what happened.
///
/// `sha` is the rewritten commit when the target was `HEAD`. After a rewrite it
/// is the branch's new tip, since the reworded commit itself is buried in the
/// middle of the history the caller will be reloading anyway.
pub fn reword(
	app: &tauri::AppHandle,
	repo_path: &str,
	commit: &str,
	message: &str,
) -> Result<CommitOutcome, GitError> {
	let ctx = context(app, repo_path, commit)?;
	let mut log: Vec<String> = Vec::new();

	let branch = match plan(&ctx) {
		Plan::Refused(r) => {
			return Ok(CommitOutcome {
				ok: false,
				sha: None,
				output: r.message().to_string(),
			});
		}
		Plan::AmendHead => {
			let o = step(app, repo_path, &amend_message_args(message), &mut log)?;
			if o.exit_code != 0 {
				return Ok(CommitOutcome { ok: false, sha: None, output: log.join("\n") });
			}
			let sha = rev_parse(app, repo_path, "HEAD")?;
			return Ok(CommitOutcome { ok: true, sha: Some(sha), output: log.join("\n") });
		}
		Plan::Rewrite { branch } => branch,
	};

	// From here on the repo is left detached until the replay puts it back, so
	// every failure path has to return to `branch` explicitly.
	let o = step(app, repo_path, &detach_args(&ctx.target_sha), &mut log)?;
	if o.exit_code != 0 {
		return Ok(CommitOutcome { ok: false, sha: None, output: log.join("\n") });
	}

	let o = step(app, repo_path, &amend_message_args(message), &mut log)?;
	if o.exit_code != 0 {
		// Nothing was rewritten yet, so getting back is a plain checkout.
		let _ = step(app, repo_path, &crate::git::branch::checkout_args(&branch), &mut log);
		return Ok(CommitOutcome { ok: false, sha: None, output: log.join("\n") });
	}
	let new_base = rev_parse(app, repo_path, "HEAD")?;

	let update_refs = supports_update_refs(
		crate::git::availability::check_git().version.as_deref().and_then(parse_version),
	);
	let replay = rebase_onto_args(&new_base, &ctx.target_sha, &branch, update_refs);
	let o = step(app, repo_path, &replay, &mut log)?;
	if o.exit_code != 0 {
		// A stopped rebase leaves the repo mid-operation, where almost nothing else
		// works. Abort before handing control back, then return to the branch — the
		// abort alone would leave HEAD detached at the amended commit.
		let _ = step(app, repo_path, &rebase_abort_args(), &mut log);
		let _ = step(app, repo_path, &crate::git::branch::checkout_args(&branch), &mut log);
		return Ok(CommitOutcome { ok: false, sha: None, output: log.join("\n") });
	}

	let tip = rev_parse(app, repo_path, "HEAD")?;
	Ok(CommitOutcome { ok: true, sha: Some(tip), output: log.join("\n") })
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn amends_with_the_message_as_one_argv_element() {
		// No shell is involved, so a message with newlines and quotes needs no
		// escaping and must arrive whole.
		let msg = "fix: don't \"break\"\n\nBody line";
		assert_eq!(
			amend_message_args(msg),
			["commit", "--amend", "--only", "--allow-empty", "-m", msg]
		);
	}

	/// REGRESSION GUARD: without `--only`, `commit --amend` commits the index, so
	/// rewording HEAD with anything staged swept those changes into the commit.
	/// `--allow-empty` goes with it because `--only` refuses on a commit that has
	/// no changes.
	#[test]
	fn reword_does_not_touch_the_index() {
		let args = amend_message_args("m");
		assert!(args.contains(&"--only".to_string()));
		assert!(args.contains(&"--allow-empty".to_string()));
	}

	#[test]
	fn detaches_explicitly() {
		assert_eq!(detach_args("abc123"), ["checkout", "--detach", "abc123"]);
	}

	/// Without --rebase-merges the replay flattens merge commits, quietly
	/// reshaping the graph as a side effect of an edit to one message.
	#[test]
	fn replay_preserves_merges() {
		assert_eq!(
			rebase_onto_args("new", "old", "main", false),
			["rebase", "--rebase-merges", "--onto", "new", "old", "main"]
		);
	}

	/// Other branches pointing into the rewritten range have to come along, or the
	/// history forks: the reworded commit on one branch, its twin still reachable
	/// from another.
	#[test]
	fn replay_carries_other_branches_along() {
		assert_eq!(
			rebase_onto_args("new", "old", "main", true),
			[
				"rebase",
				"--rebase-merges",
				"--update-refs",
				"--onto",
				"new",
				"old",
				"main"
			]
		);
	}

	#[test]
	fn reads_the_version_through_vendor_suffixes() {
		assert_eq!(parse_version("2.50.1 (Apple Git-155)"), Some((2, 50)));
		assert_eq!(parse_version("git version 2.39.5.windows.1"), Some((2, 39)));
		assert_eq!(parse_version("2.38.0"), Some((2, 38)));
		assert_eq!(parse_version("nonsense"), None);
	}

	#[test]
	fn update_refs_needs_2_38() {
		assert!(supports_update_refs(Some((2, 38))));
		assert!(supports_update_refs(Some((2, 50))));
		assert!(supports_update_refs(Some((3, 0))));
		assert!(!supports_update_refs(Some((2, 37))));
		// Unreadable version: skip the flag rather than risk an unknown-option
		// failure part-way through a rewrite.
		assert!(!supports_update_refs(None));
	}

	#[test]
	fn ancestry_is_asked_of_merge_base() {
		assert_eq!(
			is_ancestor_args("a", "b"),
			["merge-base", "--is-ancestor", "a", "b"]
		);
	}

	/// Untracked files don't stop a rebase, so they must not stop this either —
	/// otherwise a stray build artefact makes the whole feature unavailable.
	#[test]
	fn dirty_check_ignores_untracked_files() {
		assert_eq!(
			dirty_check_args(),
			["status", "--porcelain", "--untracked-files=no"]
		);
	}

	fn ctx(head: &str, target: &str) -> RewordContext {
		RewordContext {
			branch: Some("main".into()),
			head_sha: head.into(),
			target_sha: target.into(),
			target_is_ancestor: true,
			tree_dirty: false,
		}
	}

	#[test]
	fn head_is_a_plain_amend() {
		assert_eq!(plan(&ctx("aaa", "aaa")), Plan::AmendHead);
	}

	#[test]
	fn an_older_commit_is_a_rewrite() {
		assert_eq!(
			plan(&ctx("aaa", "bbb")),
			Plan::Rewrite { branch: "main".into() }
		);
	}

	/// Amending HEAD needs no branch — it rewrites nothing else — so a detached
	/// HEAD must not block it.
	#[test]
	fn head_can_be_amended_while_detached() {
		let mut c = ctx("aaa", "aaa");
		c.branch = None;
		assert_eq!(plan(&c), Plan::AmendHead);
	}

	#[test]
	fn rewriting_needs_a_branch() {
		let mut c = ctx("aaa", "bbb");
		c.branch = None;
		assert_eq!(plan(&c), Plan::Refused(Refusal::DetachedHead));
	}

	#[test]
	fn refuses_a_commit_off_the_current_branch() {
		let mut c = ctx("aaa", "bbb");
		c.target_is_ancestor = false;
		assert_eq!(plan(&c), Plan::Refused(Refusal::NotOnCurrentBranch));
	}

	#[test]
	fn refuses_a_dirty_tree() {
		let mut c = ctx("aaa", "bbb");
		c.tree_dirty = true;
		assert_eq!(plan(&c), Plan::Refused(Refusal::DirtyWorkingTree));
	}

	/// A dirty tree is no obstacle to amending HEAD: nothing gets replayed, and
	/// git carries the index into the amended commit exactly as the commit box
	/// already does.
	#[test]
	fn a_dirty_tree_does_not_block_amending_head() {
		let mut c = ctx("aaa", "aaa");
		c.tree_dirty = true;
		assert_eq!(plan(&c), Plan::AmendHead);
	}

	/// An unreachable commit is reported as such even with a dirty tree — being
	/// sent to stash and then refused anyway would be the worse message.
	#[test]
	fn reports_the_unfixable_refusal_first() {
		let mut c = ctx("aaa", "bbb");
		c.target_is_ancestor = false;
		c.tree_dirty = true;
		assert_eq!(plan(&c), Plan::Refused(Refusal::NotOnCurrentBranch));
	}
}
