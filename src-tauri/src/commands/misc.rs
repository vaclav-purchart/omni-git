use crate::git::availability::{check_git, GitStatus};

#[tauri::command]
#[specta::specta]
pub fn ping() -> String {
    "pong".to_string()
}

#[tauri::command(async)]
#[specta::specta]
pub fn git_status() -> GitStatus {
	check_git()
}

/// Reveals the main window.
///
/// It is created hidden (`"visible": false`) so startup can't flash the
/// webview's default white before the themed background is painted. The frontend
/// calls this once it knows which view to show; `lib.rs` also has a timer that
/// reveals it regardless, so a frontend failure can never leave an invisible app.
#[tauri::command]
#[specta::specta]
pub fn show_main_window(app: tauri::AppHandle) {
	show_main_window_now(&app);
}

pub fn show_main_window_now(app: &tauri::AppHandle) {
	use tauri::Manager;
	if let Some(window) = app.get_webview_window("main") {
		// Checked HERE, immediately before the window becomes visible, rather than
		// in `setup`: the window-state plugin restores last run's geometry after
		// the setup hook has already run, so a guard there reads the config
		// defaults and always concludes everything is fine. This is also the last
		// moment at which moving the window is invisible to the user.
		crate::window_guard::rescue_offscreen(&window);
		let _ = window.show();
	}
}

/// Opens the user's terminal at `dir` (the repo root).
///
/// `command` is the optional user override from settings; when absent a
/// per-platform default is used. Returns the reason as a string on failure so the
/// UI can show something actionable rather than silently doing nothing.
#[tauri::command(async)]
#[specta::specta]
pub fn open_terminal(dir: String, command: Option<String>) -> Result<(), String> {
	crate::sys::terminal::open_terminal(&dir, command.as_deref())
}
