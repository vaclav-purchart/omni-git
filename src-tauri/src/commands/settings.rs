use crate::store::repos::StoreError;
use crate::store::settings::{Settings, SettingsStore};
use tauri::Manager;

fn store(app: &tauri::AppHandle) -> Result<SettingsStore, StoreError> {
	let dir = app
		.path()
		.app_config_dir()
		.map_err(|e| StoreError::Io(e.to_string()))?;
	Ok(SettingsStore::new(dir.join("settings.json")))
}

/// Reads all UI settings. Called once, before the first render, so the frontend
/// can serve them synchronously afterwards (the startup path needs to know which
/// screen to show without waiting on IPC).
#[tauri::command(async)]
#[specta::specta]
pub fn load_settings(app: tauri::AppHandle) -> Result<Settings, StoreError> {
	store(&app)?.load()
}

/// Writes all UI settings. The frontend keeps the authoritative copy in memory
/// and saves the whole map, which avoids read-modify-write races between rapid
/// changes from different components.
#[tauri::command(async)]
#[specta::specta]
pub fn save_settings(
	app: tauri::AppHandle,
	settings: Settings,
) -> Result<(), StoreError> {
	store(&app)?.save(&settings)
}
