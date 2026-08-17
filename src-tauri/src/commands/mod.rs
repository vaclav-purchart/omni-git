/// Guards the invariant that no git-invoking command runs on the main thread.
///
/// A plain `#[tauri::command]` on a sync `fn` defaults to
/// `ExecutionContext::Blocking`, which Tauri runs on the MAIN thread — so a slow
/// git call freezes the entire window, the webview can't repaint, and streamed
/// output events sit unprocessed until the command returns. That was a real bug:
/// a multi-second `pre-commit` hook made the app look hung.
///
/// Anything that shells out to git must therefore be `#[tauri::command(async)]`
/// (sync body on a worker) or an `async fn` (see `repo_write::commit`, which uses
/// `spawn_blocking` because it can run for many seconds). Only genuinely trivial
/// commands may stay on the main thread, and they're listed explicitly here.
#[cfg(test)]
mod main_thread_guard {
	const SOURCES: &[(&str, &str)] = &[
		("misc.rs", include_str!("misc.rs")),
		("repo_read.rs", include_str!("repo_read.rs")),
		("repo_refs.rs", include_str!("repo_refs.rs")),
		("repo_write.rs", include_str!("repo_write.rs")),
		("repos.rs", include_str!("repos.rs")),
		("settings.rs", include_str!("settings.rs")),
	];

	/// Commands that do no git work: in-memory reads and small JSON-store
	/// operations. Adding to this list is a claim that the command cannot block.
	const ALLOWED_ON_MAIN_THREAD: &[&str] = &[
		"ping",
		"recent_console_entries",
		"list_repos",
		"add_repo",
		"remove_repo",
		// Posts a show request to the event loop and returns; window operations
		// belong on the main thread anyway.
		"show_main_window",
	];

	fn fn_name(line: &str) -> Option<&str> {
		let rest = line.trim().strip_prefix("pub fn ")?;
		rest.split(['(', '<']).next().map(str::trim)
	}

	#[test]
	fn no_command_blocks_the_main_thread() {
		let mut offenders = Vec::new();
		for (file, src) in SOURCES {
			let lines: Vec<&str> = src.lines().collect();
			for (i, line) in lines.iter().enumerate() {
				// Only the bare attribute is main-thread; `(async)` is fine.
				if line.trim() != "#[tauri::command]" {
					continue;
				}
				// Skip the attribute lines between it and the signature.
				let sig = lines[i + 1..].iter().find(|l| l.contains("pub "));
				let Some(sig) = sig else { continue };
				// `pub async fn` is off the main thread already.
				let Some(name) = fn_name(sig) else { continue };
				if !ALLOWED_ON_MAIN_THREAD.contains(&name) {
					offenders.push(format!("{}::{}", file, name));
				}
			}
		}
		assert!(
			offenders.is_empty(),
			"these commands would run on the main thread and freeze the UI — use \
			 #[tauri::command(async)] or an async fn, or add them to \
			 ALLOWED_ON_MAIN_THREAD if they truly cannot block: {:?}",
			offenders
		);
	}

	/// The guard is only meaningful if it can actually see the commands, so make
	/// sure the sources parsed and the allowlist entries really exist.
	#[test]
	fn guard_actually_inspects_the_command_sources() {
		let total: usize = SOURCES
			.iter()
			.map(|(_, src)| src.matches("#[tauri::command").count())
			.sum();
		assert!(total > 20, "expected to find every command, saw {}", total);
		for allowed in ALLOWED_ON_MAIN_THREAD {
			assert!(
				SOURCES
					.iter()
					.any(|(_, src)| src.contains(&format!("pub fn {}", allowed))),
				"allowlisted command {} no longer exists — drop it from the list",
				allowed
			);
		}
	}
}

pub mod misc;
pub mod repo_read;
pub mod repo_refs;
pub mod repo_write;
pub mod repos;
pub mod settings;
