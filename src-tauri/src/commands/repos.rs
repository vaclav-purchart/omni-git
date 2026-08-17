use crate::store::repos::{Repo, RepoStore, StoreError};
use tauri::Manager;

fn store(app: &tauri::AppHandle) -> Result<RepoStore, StoreError> {
	let dir = app
		.path()
		.app_config_dir()
		.map_err(|e| StoreError::Io(e.to_string()))?;
	Ok(RepoStore::new(dir.join("repos.json")))
}

#[tauri::command]
#[specta::specta]
pub fn list_repos(app: tauri::AppHandle) -> Result<Vec<Repo>, StoreError> {
	Ok(store(&app)?.list())
}

#[tauri::command]
#[specta::specta]
pub fn add_repo(app: tauri::AppHandle, path: String) -> Result<Repo, StoreError> {
	store(&app)?.add(&path)
}

#[tauri::command]
#[specta::specta]
pub fn remove_repo(app: tauri::AppHandle, id: String) -> Result<(), StoreError> {
	store(&app)?.remove(&id)
}
