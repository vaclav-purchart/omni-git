use crate::git::changes::{commit_files as gc, file_diff as gd, FileChange};
use crate::git::compare::{
	branch_diff as bd, branch_file_diff as bfd, default_branch as db, fork_base as fb,
};
use crate::git::log::{log_commits as gl, CommitSummary};
use crate::git::run::GitError;
use crate::git::working::{
	working_file_diff as gwfd, working_status as gws, WorkingSection, WorkingStatus,
};

#[tauri::command(async)]
#[specta::specta]
pub fn log_commits(
	app: tauri::AppHandle,
	repo_path: String,
	all: bool,
	skip: u32,
	limit: u32,
) -> Result<Vec<CommitSummary>, GitError> {
	gl(&app, &repo_path, all, skip, limit)
}

#[tauri::command(async)]
#[specta::specta]
pub fn commit_files(
	app: tauri::AppHandle,
	repo_path: String,
	hash: String,
) -> Result<Vec<FileChange>, GitError> {
	gc(&app, &repo_path, &hash)
}

#[tauri::command(async)]
#[specta::specta]
pub fn file_diff(
	app: tauri::AppHandle,
	repo_path: String,
	hash: String,
	path: String,
	ignore_whitespace: bool,
	force_text: bool,
) -> Result<String, GitError> {
	gd(&app, &repo_path, &hash, &path, ignore_whitespace, force_text)
}

#[tauri::command(async)]
#[specta::specta]
pub fn default_branch(app: tauri::AppHandle, repo_path: String) -> Option<String> {
	db(&app, &repo_path)
}

#[tauri::command(async)]
#[specta::specta]
pub fn branch_diff(
	app: tauri::AppHandle,
	repo_path: String,
	base: String,
	head: String,
	include_worktree: bool,
) -> Result<Vec<FileChange>, GitError> {
	bd(&app, &repo_path, &base, &head, include_worktree)
}

#[tauri::command(async)]
#[specta::specta]
pub fn branch_file_diff(
	app: tauri::AppHandle,
	repo_path: String,
	base: String,
	head: String,
	path: String,
	ignore_whitespace: bool,
	force_text: bool,
	include_worktree: bool,
) -> Result<String, GitError> {
	bfd(
		&app,
		&repo_path,
		&base,
		&head,
		&path,
		ignore_whitespace,
		force_text,
		include_worktree,
	)
}

#[tauri::command(async)]
#[specta::specta]
pub fn fork_base(app: tauri::AppHandle, repo_path: String, head: String) -> Option<String> {
	fb(&app, &repo_path, &head)
}

#[tauri::command(async)]
#[specta::specta]
pub fn working_status(
	app: tauri::AppHandle,
	repo_path: String,
) -> Result<WorkingStatus, GitError> {
	gws(&app, &repo_path)
}

#[tauri::command(async)]
#[specta::specta]
pub fn working_file_diff(
	app: tauri::AppHandle,
	repo_path: String,
	path: String,
	section: WorkingSection,
	ignore_whitespace: bool,
	force_text: bool,
) -> Result<String, GitError> {
	gwfd(&app, &repo_path, &path, section, ignore_whitespace, force_text)
}

#[tauri::command]
#[specta::specta]
pub fn recent_console_entries(
	app: tauri::AppHandle,
) -> Vec<crate::git::run::GitConsoleEntry> {
	use tauri::Manager;
	app.state::<crate::console_log::ConsoleLog>().recent()
}

/// The files inside a stash, including any that were untracked when it was taken.
#[tauri::command(async)]
#[specta::specta]
pub fn stash_files(
	app: tauri::AppHandle,
	repo_path: String,
	selector: String,
) -> Result<Vec<crate::git::changes::FileChange>, GitError> {
	crate::git::stash_show::stash_files(&app, &repo_path, &selector)
}

/// One stashed file's patch. See `git::stash_show` for why a stash needs two
/// different diff routes.
#[tauri::command(async)]
#[specta::specta]
pub fn stash_file_diff(
	app: tauri::AppHandle,
	repo_path: String,
	selector: String,
	path: String,
	ignore_whitespace: bool,
	force_text: bool,
) -> Result<String, GitError> {
	crate::git::stash_show::stash_file_diff(
		&app,
		&repo_path,
		&selector,
		&path,
		ignore_whitespace,
		force_text,
	)
}

/// What the repo is in the middle of (merge, rebase, cherry-pick…) and which
/// files are blocking it. `kind: null` when nothing is in progress.
#[tauri::command(async)]
#[specta::specta]
pub fn repo_operation(
	app: tauri::AppHandle,
	repo_path: String,
) -> Result<crate::git::conflict::RepoOperation, GitError> {
	crate::git::conflict::repo_operation(&app, &repo_path)
}

/// The configured URL of the repo's first remote (`origin` in almost every repo).
///
/// Returned raw, in whatever form it was cloned with — deriving a browsable web
/// URL from it is the frontend's job, where the per-forge shapes are pure and
/// unit-testable (`remoteFileUrl.ts`).
#[tauri::command(async)]
#[specta::specta]
pub fn remote_url(app: tauri::AppHandle, repo_path: String) -> Result<String, GitError> {
	let remote = crate::git::remote::first_remote(&app, &repo_path);
	crate::git::remote::remote_url(&app, &repo_path, &remote)
}

/// Whether `sha` is on any remote-tracking branch — i.e. whether a web link to it
/// would resolve for someone else, or 404 because the commit is still only local.
#[tauri::command(async)]
#[specta::specta]
pub fn commit_on_remote(
	app: tauri::AppHandle,
	repo_path: String,
	sha: String,
) -> Result<bool, GitError> {
	crate::git::remote::commit_on_remote(&app, &repo_path, &sha)
}
