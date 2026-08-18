use serde::Serialize;
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct GitConsoleEntry {
	pub id: String,
	pub command: String,
	pub exit_code: i32,
	pub duration_ms: u64,
	pub stderr: String,
	pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub enum GitError {
	Spawn(String),
	NonZero { code: i32, stderr: String },
}

fn now_ms() -> i64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.as_millis() as i64)
		.unwrap_or(0)
}

/// Builds the `git -C <repo_path> <args...>` command with the environment we
/// always want.
///
/// GIT_OPTIONAL_LOCKS=0 stops read commands (notably `git status`) from
/// opportunistically rewriting `.git/index` to refresh its stat / untracked
/// cache. Without it, the FS watcher (which watches `.git`) sees the index
/// change, emits `repo-changed`, the view refreshes and re-runs `git status`,
/// which rewrites the index again — a feedback loop that makes the UI flicker.
/// Required locks (e.g. `git add`/`commit`/`restore` writing the index) are
/// unaffected, so write operations still work correctly.
/// PATH is replaced with the user's login-shell PATH (see `git::env`) because a
/// bundled macOS app inherits launchd's bare `/usr/bin:/bin:/usr/sbin:/sbin`.
/// git itself is in `/usr/bin` so this stays invisible until a hook shells out
/// to a homebrew/nvm/volta tool and dies with "command not found".
pub(crate) fn git_command(repo_path: &str, args: &[&str]) -> Command {
	let mut cmd = Command::new("git");
	crate::sys::hide_console(&mut cmd);
	cmd.env("GIT_OPTIONAL_LOCKS", "0");
	// There is no terminal behind these processes, so a git that decides to prompt
	// for credentials would block forever with nothing to read. Failing fast with
	// git's own "could not read Username" is far better than a hung push. This
	// does NOT disable credential HELPERS (osxkeychain, manager, etc.) — only
	// interactive terminal prompting, which we could never service anyway.
	cmd.env("GIT_TERMINAL_PROMPT", "0");
	// No command this app runs should ever open an editor, and one that tried
	// would hang forever: there is no terminal behind these processes to service
	// it. `git rebase --continue` and `git merge --continue` DO try — verified —
	// falling back to $EDITOR or vi. `true` exits 0 immediately, which git reads
	// as "the message was accepted unedited", exactly what an app-driven continue
	// wants.
	cmd.env("GIT_EDITOR", "true");
	if let Some(path) = crate::git::env::git_path() {
		cmd.env("PATH", path);
	}
	cmd.arg("-C").arg(repo_path).args(args);
	cmd
}

/// Runs `git -C <repo_path> <args...>`, capturing output and timing.
/// Returns (stdout, entry) regardless of exit status so callers can both
/// inspect the result and log it. Pure enough to unit-test without Tauri.
fn run_raw(repo_path: &str, args: &[&str]) -> Result<(String, GitConsoleEntry), GitError> {
	let started = Instant::now();
	let output = git_command(repo_path, args)
		.output()
		.map_err(|e| GitError::Spawn(e.to_string()))?;
	let duration_ms = started.elapsed().as_millis() as u64;
	let stdout = String::from_utf8_lossy(&output.stdout).to_string();
	let stderr = String::from_utf8_lossy(&output.stderr).to_string();
	let exit_code = output.status.code().unwrap_or(-1);
	let entry = GitConsoleEntry {
		id: uuid::Uuid::new_v4().to_string(),
		command: format!("git -C {} {}", repo_path, args.join(" ")),
		exit_code,
		duration_ms,
		stderr: stderr.clone(),
		timestamp_ms: now_ms(),
	};
	Ok((stdout, entry))
}

/// The full result of a git invocation, including BOTH streams.
///
/// `GitError::NonZero` carries only stderr, which is not enough for commands
/// whose output is the point even when they fail: hooks (husky, lint-staged,
/// `yarn` wrappers) routinely print their diagnostics to **stdout**, so a
/// rejected `git commit` explaining itself on stdout would otherwise surface as
/// an empty error.
pub struct Outcome {
	pub exit_code: i32,
	pub stdout: String,
	pub stderr: String,
}

/// Records an invocation for the git console: into the ring buffer so
/// late-attaching listeners (and the frontend's first paint) still see it, then
/// emitted live. `try_state` so `run_raw`-only unit tests without a managed
/// state still work; emit failures are ignored.
pub(crate) fn record(app: &tauri::AppHandle, entry: GitConsoleEntry) {
	use tauri::Manager;
	if let Some(log) = app.try_state::<crate::console_log::ConsoleLog>() {
		log.push(entry.clone());
	}
	let _ = entry.emit(app);
}

pub fn run(
	app: &tauri::AppHandle,
	repo_path: &str,
	args: &[&str],
) -> Result<String, GitError> {
	run_allowing(app, repo_path, args, &[])
}

/// Runs git and returns the outcome instead of mapping a non-zero exit to an
/// error, so callers can show the command's own output either way. Still errors
/// if the process can't be spawned at all.
pub fn run_capturing(
	app: &tauri::AppHandle,
	repo_path: &str,
	args: &[&str],
) -> Result<Outcome, GitError> {
	let (stdout, entry) = run_raw(repo_path, args)?;
	let outcome =
		Outcome { exit_code: entry.exit_code, stdout, stderr: entry.stderr.clone() };
	record(app, entry);
	Ok(outcome)
}

/// Like `run`, but treats exit codes in `extra_ok` (besides 0) as success.
/// Needed for `git diff --no-index`, which exits 1 when files differ.
pub fn run_allowing(
	app: &tauri::AppHandle,
	repo_path: &str,
	args: &[&str],
	extra_ok: &[i32],
) -> Result<String, GitError> {
	let o = run_capturing(app, repo_path, args)?;
	if o.exit_code == 0 || extra_ok.contains(&o.exit_code) {
		Ok(o.stdout)
	} else {
		Err(GitError::NonZero { code: o.exit_code, stderr: o.stderr })
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command as StdCommand;

	fn temp_repo_with_one_commit() -> tempfile::TempDir {
		let dir = tempfile::tempdir().unwrap();
		let p = dir.path();
		for args in [
			vec!["init"],
			vec!["config", "user.email", "t@e.st"],
			vec!["config", "user.name", "Test"],
		] {
			StdCommand::new("git").arg("-C").arg(p).args(&args).output().unwrap();
		}
		std::fs::write(p.join("a.txt"), "hello\n").unwrap();
		StdCommand::new("git").arg("-C").arg(p).args(["add", "."]).output().unwrap();
		StdCommand::new("git")
			.arg("-C")
			.arg(p)
			.args(["commit", "-m", "first"])
			.output()
			.unwrap();
		dir
	}

	#[test]
	fn run_raw_captures_stdout_and_entry_on_success() {
		let repo = temp_repo_with_one_commit();
		let (stdout, entry) =
			run_raw(repo.path().to_str().unwrap(), &["rev-parse", "HEAD"]).unwrap();
		assert_eq!(stdout.trim().len(), 40, "HEAD should be a 40-char sha");
		assert_eq!(entry.exit_code, 0);
		assert!(entry.command.contains("rev-parse HEAD"));
	}

	#[test]
	fn run_raw_reports_nonzero_via_entry() {
		let repo = temp_repo_with_one_commit();
		let (_stdout, entry) =
			run_raw(repo.path().to_str().unwrap(), &["cat-file", "-e", "deadbeef"]).unwrap();
		assert_ne!(entry.exit_code, 0, "unknown object should exit non-zero");
	}

	// Regression guard for the "Uncommitted changes" flicker: every git
	// invocation must run with GIT_OPTIONAL_LOCKS=0 so read commands (esp.
	// `git status`) don't rewrite `.git/index` and retrigger the `.git` FS
	// watcher → refresh → status → rewrite … feedback loop.
	#[test]
	fn git_command_disables_optional_locks() {
		let cmd = git_command("/some/repo", &["status", "--porcelain"]);
		let set = cmd.get_envs().any(|(k, v)| {
			k == std::ffi::OsStr::new("GIT_OPTIONAL_LOCKS")
				&& v == Some(std::ffi::OsStr::new("0"))
		});
		assert!(set, "git commands must run with GIT_OPTIONAL_LOCKS=0");
	}

	/// Nothing can answer a terminal prompt here, so it must be refused rather
	/// than left to hang. Credential helpers are unaffected.
	#[test]
	fn git_command_disables_terminal_prompting() {
		let cmd = git_command("/some/repo", &["push"]);
		let set = cmd.get_envs().any(|(k, v)| {
			k == std::ffi::OsStr::new("GIT_TERMINAL_PROMPT")
				&& v == Some(std::ffi::OsStr::new("0"))
		});
		assert!(set, "git must not wait on a terminal prompt");
	}

	#[test]
	fn git_command_passes_repo_and_args() {
		let cmd = git_command("/some/repo", &["status", "--porcelain"]);
		let args: Vec<_> = cmd.get_args().collect();
		assert_eq!(
			args,
			["-C", "/some/repo", "status", "--porcelain"]
				.map(std::ffi::OsStr::new)
				.to_vec()
		);
	}
}
