use crate::git::refs::{list_refs as lr, RepoRefs};
use crate::git::run::GitError;
use crate::git::stashes::{list_stashes as ls, Stash};
use crate::git::worktrees::{list_worktrees as lw, Worktree};

#[tauri::command(async)]
#[specta::specta]
pub fn list_refs(app: tauri::AppHandle, repo_path: String) -> Result<RepoRefs, GitError> {
	lr(&app, &repo_path)
}

#[tauri::command(async)]
#[specta::specta]
pub fn list_worktrees(
	app: tauri::AppHandle,
	repo_path: String,
) -> Result<Vec<Worktree>, GitError> {
	lw(&app, &repo_path)
}

#[tauri::command(async)]
#[specta::specta]
pub fn list_stashes(app: tauri::AppHandle, repo_path: String) -> Result<Vec<Stash>, GitError> {
	ls(&app, &repo_path)
}
