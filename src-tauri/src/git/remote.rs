//! fetch / pull / push.
//!
//! All three stream (see `git::stream`), because they're the slowest thing the app
//! does and watching them work is most of the value.
//!
//! Two environment facts shape this:
//!
//! * git writes progress only when it thinks a terminal is attached, so
//!   `--progress` has to be passed explicitly or the output arrives in one lump at
//!   the end.
//! * there IS no terminal, so `GIT_TERMINAL_PROMPT=0` (set in `git::run`) makes a
//!   credential prompt fail immediately instead of hanging. Credential *helpers*
//!   still work, which is how this succeeds at all.

use crate::git::run::{run, GitError, Outcome};
use crate::git::stream::run_streaming;

/// `--progress` is not optional here: stdout is a pipe, so git would otherwise
/// suppress the progress reporting entirely and the panel would sit empty until
/// the transfer finished.
pub fn fetch_args(prune: bool) -> Vec<String> {
	let mut args = vec!["fetch".to_string(), "--all".into()];
	if prune {
		// Drops remote-tracking refs (`origin/foo`) for branches deleted upstream,
		// so the sidebar doesn't accumulate branches that no longer exist. It does
		// NOT touch local branches — but it is still a matter of taste, since a
		// stale `origin/foo` is sometimes exactly what you wanted to keep.
		args.push("--prune".into());
	}
	args.push("--progress".into());
	args
}

pub fn pull_args() -> Vec<String> {
	vec!["pull".into(), "--progress".into()]
}

/// `set_upstream` pushes with `-u <remote> HEAD`, for a branch that has no
/// upstream yet — otherwise git refuses with "no upstream configured".
///
/// `HEAD` rather than the branch name so no name has to be looked up or quoted;
/// git resolves it to the current branch and sets the upstream to
/// `<remote>/<that name>`.
pub fn push_args(set_upstream: bool, remote: &str) -> Vec<String> {
	let mut args = vec!["push".into(), "--progress".into()];
	if set_upstream {
		args.push("-u".into());
		args.push(remote.to_string());
		args.push("HEAD".into());
	}
	args
}

/// The remote to push a new branch to: the first one git lists, which is
/// `git remote get-url <remote>`: the configured URL, in whatever form the user
/// cloned with (scp-style ssh, https, ssh://). Turning that into a browsable web
/// URL is the frontend's job — see `remoteFileUrl.ts`, where the per-forge shapes
/// are unit-testable without a repo.
pub fn remote_url_args(remote: &str) -> Vec<String> {
	vec!["remote".into(), "get-url".into(), remote.to_string()]
}

/// `git branch -r --contains <sha>`: the remote-tracking branches a commit is on.
///
/// `-r` restricts it to remote-tracking refs, which is what decides whether a web
/// link can resolve at all. A commit that is only local produces no output, and a
/// URL built for it would 404 for the person it was sent to.
pub fn remote_branches_containing_args(sha: &str) -> Vec<String> {
	vec![
		"branch".into(),
		"-r".into(),
		"--contains".into(),
		sha.to_string(),
	]
}

/// The configured URL of `remote`, trimmed. Errors if the remote does not exist.
pub fn remote_url(
	app: &tauri::AppHandle,
	repo_path: &str,
	remote: &str,
) -> Result<String, GitError> {
	let args = remote_url_args(remote);
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	Ok(run(app, repo_path, &argv)?.trim().to_string())
}

/// Whether `sha` exists on any remote-tracking branch, i.e. whether a web link to
/// it can resolve.
pub fn commit_on_remote(
	app: &tauri::AppHandle,
	repo_path: &str,
	sha: &str,
) -> Result<bool, GitError> {
	let args = remote_branches_containing_args(sha);
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	// A sha that no longer exists at all makes git exit non-zero; that is a "no"
	// for this question rather than an error worth surfacing.
	Ok(match run(app, repo_path, &argv) {
		Ok(out) => out.lines().any(|l| !l.trim().is_empty()),
		Err(_) => false,
	})
}

/// `origin` in almost every repo. Falls back to "origin" when there are none, so
/// the error the user sees comes from git and names the real problem.
pub fn first_remote(app: &tauri::AppHandle, repo_path: &str) -> String {
	run(app, repo_path, &["remote"])
		.ok()
		.and_then(|out| out.lines().map(str::trim).find(|l| !l.is_empty()).map(String::from))
		.unwrap_or_else(|| "origin".to_string())
}

fn stream(
	app: &tauri::AppHandle,
	repo_path: &str,
	args: &[String],
	run_id: &str,
) -> Result<Outcome, GitError> {
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	run_streaming(app, repo_path, &argv, run_id)
}

pub fn fetch(
	app: &tauri::AppHandle,
	repo_path: &str,
	prune: bool,
	run_id: &str,
) -> Result<Outcome, GitError> {
	stream(app, repo_path, &fetch_args(prune), run_id)
}

pub fn pull(
	app: &tauri::AppHandle,
	repo_path: &str,
	run_id: &str,
) -> Result<Outcome, GitError> {
	stream(app, repo_path, &pull_args(), run_id)
}

pub fn push(
	app: &tauri::AppHandle,
	repo_path: &str,
	set_upstream: bool,
	run_id: &str,
) -> Result<Outcome, GitError> {
	let remote = if set_upstream {
		first_remote(app, repo_path)
	} else {
		String::new()
	};
	stream(app, repo_path, &push_args(set_upstream, &remote), run_id)
}

#[cfg(test)]
mod tests {
	use super::*;

	/// The one thing that must never be dropped: without it the output panel stays
	/// empty for the whole transfer, which is exactly what streaming was for.
	#[test]
	fn every_command_asks_for_progress() {
		assert!(fetch_args(true).contains(&"--progress".to_string()));
		assert!(fetch_args(false).contains(&"--progress".to_string()));
		assert!(pull_args().contains(&"--progress".to_string()));
		assert!(push_args(false, "origin").contains(&"--progress".to_string()));
		assert!(push_args(true, "origin").contains(&"--progress".to_string()));
	}

	/// git is the only place the remote's URL lives, and it is what a browsable
	/// link has to be derived from.
	#[test]
	fn remote_url_asks_git_for_the_configured_url() {
		assert_eq!(remote_url_args("origin"), ["remote", "get-url", "origin"]);
	}

	/// `-r` is the whole point: only REMOTE-tracking branches count. A commit that
	/// exists only locally has no web URL, and a link to it would 404 for whoever
	/// it was sent to — which is the one failure worth preventing here.
	#[test]
	fn contains_looks_only_at_remote_branches() {
		let args = remote_branches_containing_args("abc1234");

		assert_eq!(args, ["branch", "-r", "--contains", "abc1234"]);
	}

	#[test]
	fn fetch_covers_all_remotes() {
		let args = fetch_args(true);

		assert_eq!(args[0], "fetch");
		assert!(args.contains(&"--all".to_string()));
		assert!(args.contains(&"--prune".to_string()));
	}

	/// Pruning is a preference, not a fixed part of fetching: a stale
	/// `origin/foo` is sometimes exactly what you meant to keep.
	#[test]
	fn fetch_can_leave_stale_remote_refs_alone() {
		assert!(!fetch_args(false).contains(&"--prune".to_string()));
	}

	#[test]
	fn plain_push_takes_no_refspec() {
		let args = push_args(false, "origin");

		assert_eq!(args, ["push", "--progress"]);
	}

	/// A branch with no upstream needs `-u`, or git refuses outright.
	#[test]
	fn push_sets_upstream_when_asked() {
		let args = push_args(true, "origin");

		assert_eq!(args, ["push", "--progress", "-u", "origin", "HEAD"]);
	}

	#[test]
	fn push_honours_a_non_origin_remote() {
		let args = push_args(true, "upstream");

		assert_eq!(args, ["push", "--progress", "-u", "upstream", "HEAD"]);
	}

	/// HEAD, not a branch name: nothing to look up, nothing to quote, and it
	/// can't disagree with what's actually checked out.
	#[test]
	fn push_pushes_head_rather_than_a_branch_name() {
		assert!(push_args(true, "origin").contains(&"HEAD".to_string()));
	}
}
