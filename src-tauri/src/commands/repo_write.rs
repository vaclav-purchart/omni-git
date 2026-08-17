use crate::git::commit as commit_git;
use crate::git::run::GitError;
use crate::git::stage;

/// Commits the staged index (or amends `HEAD`). A hook rejection comes back as
/// `ok: false` with the hook's output, not as an error — see `git::commit`.
///
/// `async` + `spawn_blocking` rather than the `#[tauri::command(async)]` used by
/// the read commands: a plain `#[tauri::command]` would run on the MAIN thread
/// and freeze the whole window for as long as the hooks take (the reported
/// symptom — a spinning cursor and no output until it was all over), while
/// `(async)` would merely move the block onto an async worker. This is the one
/// command that can legitimately run for many seconds, so it belongs on the
/// blocking pool where long work is expected.
#[tauri::command]
#[specta::specta]
pub async fn commit(
	app: tauri::AppHandle,
	repo_path: String,
	message: String,
	amend: bool,
	run_id: String,
) -> Result<commit_git::CommitOutcome, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		commit_git::commit(&app, &repo_path, &message, amend, &run_id)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("commit task failed: {e}"))))
}

#[tauri::command(async)]
#[specta::specta]
pub fn head_commit_message(
	app: tauri::AppHandle,
	repo_path: String,
) -> Result<Option<String>, GitError> {
	commit_git::head_commit_message(&app, &repo_path)
}

/// Full message (subject + body) of an arbitrary commit — `log_commits` only
/// carries the subject.
#[tauri::command(async)]
#[specta::specta]
pub fn commit_message(
	app: tauri::AppHandle,
	repo_path: String,
	hash: String,
) -> Result<String, GitError> {
	commit_git::commit_message(&app, &repo_path, &hash)
}

#[tauri::command(async)]
#[specta::specta]
pub fn recent_commit_messages(
	app: tauri::AppHandle,
	repo_path: String,
	limit: u32,
) -> Result<Vec<String>, GitError> {
	commit_git::recent_commit_messages(&app, &repo_path, limit)
}

#[tauri::command(async)]
#[specta::specta]
pub fn stage_file(app: tauri::AppHandle, repo_path: String, path: String) -> Result<(), GitError> {
	stage::stage_file(&app, &repo_path, &path)
}

#[tauri::command(async)]
#[specta::specta]
pub fn unstage_file(app: tauri::AppHandle, repo_path: String, path: String) -> Result<(), GitError> {
	stage::unstage_file(&app, &repo_path, &path)
}

#[tauri::command(async)]
#[specta::specta]
pub fn stage_all(app: tauri::AppHandle, repo_path: String) -> Result<(), GitError> {
	stage::stage_all(&app, &repo_path)
}

#[tauri::command(async)]
#[specta::specta]
pub fn unstage_all(app: tauri::AppHandle, repo_path: String) -> Result<(), GitError> {
	stage::unstage_all(&app, &repo_path)
}

/// Stages the Unstaged group only (tracked modifications).
#[tauri::command(async)]
#[specta::specta]
pub fn stage_tracked(app: tauri::AppHandle, repo_path: String) -> Result<(), GitError> {
	stage::stage_tracked(&app, &repo_path)
}

/// Stages an explicit list of paths — the Untracked group.
#[tauri::command(async)]
#[specta::specta]
pub fn stage_paths(
	app: tauri::AppHandle,
	repo_path: String,
	paths: Vec<String>,
) -> Result<(), GitError> {
	stage::stage_paths(&app, &repo_path, &paths)
}

/// Unstages an explicit list of paths — a multi-selection in the Staged group.
#[tauri::command(async)]
#[specta::specta]
pub fn unstage_paths(
	app: tauri::AppHandle,
	repo_path: String,
	paths: Vec<String>,
) -> Result<(), GitError> {
	stage::unstage_paths(&app, &repo_path, &paths)
}

/// Discards the unstaged edits to an explicit list of tracked paths.
#[tauri::command(async)]
#[specta::specta]
pub fn discard_paths(
	app: tauri::AppHandle,
	repo_path: String,
	paths: Vec<String>,
) -> Result<(), GitError> {
	stage::discard_paths(&app, &repo_path, &paths)
}

/// Deletes an explicit list of untracked paths.
#[tauri::command(async)]
#[specta::specta]
pub fn clean_paths(
	app: tauri::AppHandle,
	repo_path: String,
	paths: Vec<String>,
) -> Result<(), GitError> {
	stage::clean_paths(&app, &repo_path, &paths)
}

/// Discards every unstaged edit to tracked files.
#[tauri::command(async)]
#[specta::specta]
pub fn discard_all_unstaged(
	app: tauri::AppHandle,
	repo_path: String,
) -> Result<(), GitError> {
	stage::discard_all_unstaged(&app, &repo_path)
}

/// Deletes every untracked file and directory.
#[tauri::command(async)]
#[specta::specta]
pub fn clean_untracked(
	app: tauri::AppHandle,
	repo_path: String,
) -> Result<(), GitError> {
	stage::clean_untracked(&app, &repo_path)
}

#[tauri::command(async)]
#[specta::specta]
pub fn discard_file(
	app: tauri::AppHandle,
	repo_path: String,
	path: String,
	untracked: bool,
) -> Result<(), GitError> {
	stage::discard_file(&app, &repo_path, &path, untracked)
}

/// Runs an arbitrary git command typed into the command palette, streaming its
/// output like `commit` does.
///
/// `async` + `spawn_blocking` for the same reason as `commit`: the user can type
/// something long-running (`fetch`, `gc`), and a plain command would run on the
/// main thread and freeze the window.
///
/// Returns whether git exited 0. Argument parsing happens in `git::palette`, so
/// a quoting mistake comes back as an error instead of running something other
/// than what was typed.
#[tauri::command]
#[specta::specta]
pub async fn run_git_command(
	app: tauri::AppHandle,
	repo_path: String,
	input: String,
	run_id: String,
) -> Result<bool, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::palette::run_command(&app, &repo_path, &input, &run_id)
			.map(|o| o.exit_code == 0)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("command task failed: {e}"))))
}

/// Streams `git fetch --all --prune`. Long-running, so `spawn_blocking` like
/// `commit` — a plain command would freeze the window for the whole transfer.
#[tauri::command]
#[specta::specta]
pub async fn fetch(
	app: tauri::AppHandle,
	repo_path: String,
	prune: bool,
	run_id: String,
) -> Result<bool, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::remote::fetch(&app, &repo_path, prune, &run_id).map(|o| o.exit_code == 0)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("fetch task failed: {e}"))))
}

/// Streams `git pull`.
#[tauri::command]
#[specta::specta]
pub async fn pull(
	app: tauri::AppHandle,
	repo_path: String,
	run_id: String,
) -> Result<bool, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::remote::pull(&app, &repo_path, &run_id).map(|o| o.exit_code == 0)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("pull task failed: {e}"))))
}

/// Streams `git push`. `set_upstream` is for a branch that has none yet — the
/// frontend already knows, since `list_refs` reports each branch's upstream.
#[tauri::command]
#[specta::specta]
pub async fn push(
	app: tauri::AppHandle,
	repo_path: String,
	set_upstream: bool,
	run_id: String,
) -> Result<bool, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::remote::push(&app, &repo_path, set_upstream, &run_id)
			.map(|o| o.exit_code == 0)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("push task failed: {e}"))))
}

/// One entry point for every branch operation, so they share the streaming,
/// the spawn_blocking and the error mapping instead of repeating them five times.
///
/// `kind` decides the argv; see `git::branch` for what each builds and why.
#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
#[serde(tag = "kind")]
pub enum BranchOp {
	/// Switch to an existing local branch (or any committish git accepts).
	Checkout { target: String },
	/// Create a local branch tracking a remote one, and switch to it.
	CheckoutRemote { remote_ref: String },
	/// Detach HEAD at a commit.
	CheckoutCommit { commit: String },
	Create { name: String, start_point: String, checkout: bool },
	Delete { name: String, force: bool },
	DeleteRemote { remote: String, branch: String },
}

fn branch_argv(op: &BranchOp) -> Vec<String> {
	use crate::git::branch as b;
	match op {
		BranchOp::Checkout { target } => b::checkout_args(target),
		BranchOp::CheckoutRemote { remote_ref } => b::checkout_remote_args(remote_ref),
		BranchOp::CheckoutCommit { commit } => b::checkout_commit_args(commit),
		BranchOp::Create { name, start_point, checkout } => {
			b::create_branch_args(name, start_point, *checkout)
		}
		BranchOp::Delete { name, force } => b::delete_branch_args(name, *force),
		BranchOp::DeleteRemote { remote, branch } => {
			b::delete_remote_branch_args(remote, branch)
		}
	}
}

/// Runs a branch operation, streaming its output. `spawn_blocking` like the other
/// write commands: a checkout of a large tree is not instant.
#[tauri::command]
#[specta::specta]
pub async fn branch_op(
	app: tauri::AppHandle,
	repo_path: String,
	op: BranchOp,
	run_id: String,
) -> Result<bool, GitError> {
	let argv = branch_argv(&op);
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::branch::run(&app, &repo_path, &argv, &run_id)
			.map(|o| o.exit_code == 0)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("branch task failed: {e}"))))
}

/// Runs `git reset --<mode> <commit>`, streaming its output.
///
/// Streamed like the other write commands: a hard reset of a large tree is not
/// instant, and a refusal (an unmerged path, a locked index) needs to be seen.
#[tauri::command]
#[specta::specta]
pub async fn reset(
	app: tauri::AppHandle,
	repo_path: String,
	mode: crate::git::branch::ResetMode,
	commit: String,
	run_id: String,
) -> Result<bool, GitError> {
	let argv = crate::git::branch::reset_args(mode, &commit);
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::branch::run(&app, &repo_path, &argv, &run_id)
			.map(|o| o.exit_code == 0)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("reset task failed: {e}"))))
}

/// Rewords `commit`'s message.
///
/// For `HEAD` this amends. For an older commit it rewrites history — see
/// `git::reword` for why that is unavoidable and how the rewrite is driven. A
/// refusal (a hook, a stopped rebase, or a precondition the repo doesn't meet)
/// comes back as `ok: false` carrying the explanation, not as an error.
///
/// `async` + `spawn_blocking` for the same reason as `commit`: this runs hooks
/// and a rebase, so it can legitimately take seconds, and a plain
/// `#[tauri::command]` would run it on the MAIN thread and freeze the window.
#[tauri::command]
#[specta::specta]
pub async fn reword_commit(
	app: tauri::AppHandle,
	repo_path: String,
	commit: String,
	message: String,
) -> Result<commit_git::CommitOutcome, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::reword::reword(&app, &repo_path, &commit, &message)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("reword task failed: {e}"))))
}

/// Cherry-picks `commits` (newest-first, as the log shows them) onto whatever is
/// checked out.
///
/// `no_commit` applies the changes and leaves them staged instead of committing
/// each pick. A conflict, or a refusal, comes back as `ok: false` carrying git's
/// own output — which for cherry-pick is also the instructions for getting out
/// again, so it must reach the user intact.
///
/// `async` + `spawn_blocking` like `commit`: picking a run of commits runs hooks
/// per commit and can take seconds, and a plain `#[tauri::command]` would run it
/// on the MAIN thread and freeze the window.
#[tauri::command]
#[specta::specta]
pub async fn cherry_pick(
	app: tauri::AppHandle,
	repo_path: String,
	commits: Vec<String>,
	no_commit: bool,
	run_id: String,
) -> Result<commit_git::CommitOutcome, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::cherry_pick::cherry_pick(
			&app,
			&repo_path,
			&commits,
			no_commit,
			&run_id,
		)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("cherry-pick task failed: {e}"))))
}

/// Applies a stash, optionally dropping it (`pop`).
///
/// Streamed like the other write commands: applying a large stash is not instant,
/// and a conflict has to be seen — git leaves the working tree half-merged on
/// purpose, and keeps a popped stash when that happens.
#[tauri::command]
#[specta::specta]
pub async fn restore_stash(
	app: tauri::AppHandle,
	repo_path: String,
	selector: String,
	pop: bool,
	run_id: String,
) -> Result<commit_git::CommitOutcome, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::stash_show::restore_stash(&app, &repo_path, &selector, pop, &run_id)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("stash task failed: {e}"))))
}

/// `git stash push -u [-m <message>]`.
///
/// `-u` includes untracked files: a stash that quietly left them behind is a
/// stash that doesn't put the working tree back the way it was.
#[tauri::command]
#[specta::specta]
pub async fn stash_push(
	app: tauri::AppHandle,
	repo_path: String,
	message: String,
	run_id: String,
) -> Result<commit_git::CommitOutcome, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::stash_show::stash_push(&app, &repo_path, &message, &run_id)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("stash task failed: {e}"))))
}

/// Merges `target` into the checked-out branch.
///
/// A conflict comes back as `ok: false` carrying git's own output: it left the
/// working tree with the conflicting files on purpose, and that message is what
/// says so — see `git::merge`.
#[tauri::command]
#[specta::specta]
pub async fn merge(
	app: tauri::AppHandle,
	repo_path: String,
	target: String,
	mode: crate::git::merge::MergeMode,
	run_id: String,
) -> Result<commit_git::CommitOutcome, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::merge::merge(&app, &repo_path, &target, mode, &run_id)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("merge task failed: {e}"))))
}

/// Continues, aborts or skips whatever the repo is in the middle of.
///
/// Streamed: a continue runs hooks and can rebuild many commits. A refusal comes
/// back as `ok: false` with git's own words, which name the files still in the
/// way — see `git::conflict`.
#[tauri::command]
#[specta::specta]
pub async fn operation_action(
	app: tauri::AppHandle,
	repo_path: String,
	kind: crate::git::conflict::OperationKind,
	action: crate::git::conflict::OperationAction,
	run_id: String,
) -> Result<commit_git::CommitOutcome, GitError> {
	tauri::async_runtime::spawn_blocking(move || {
		crate::git::conflict::run_action(&app, &repo_path, kind, action, &run_id)
	})
	.await
	.unwrap_or_else(|e| Err(GitError::Spawn(format!("operation task failed: {e}"))))
}
