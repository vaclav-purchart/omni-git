//! Streaming git invocations.
//!
//! `run`/`run_capturing` use `Command::output()`, which buffers everything until
//! the process exits. That's fine for a `git log`, but a `pre-commit` hook can
//! easily take seconds (lefthook → lint-staged → yarn), and the user just gets a
//! spinner followed by a wall of text that was already stale when it appeared.
//!
//! Here both pipes are drained by their own threads and each chunk is emitted as
//! it arrives, so the UI can show the hook working in real time.
//!
//! **No PTY.** git and hooks run against pipes, not a terminal, so tools that
//! gate output on `isatty` may drop colour or progress bars. That's the same
//! deal every non-terminal git client gets; a real pty would need a new
//! dependency and is a separate change.

use crate::git::run::{git_command, record, GitConsoleEntry, GitError, Outcome};
use serde::Serialize;
use std::io::Read;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri_specta::Event;

/// One piece of output from a running command. Chunks are NOT line-delimited:
/// progress that redraws with `\r` has to reach the UI before its line ends.
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct CommandChunk {
	/// Correlates with the `run_id` the caller passed in, so the frontend can
	/// ignore chunks from a run it isn't showing.
	pub run_id: String,
	pub stderr: bool,
	pub text: String,
}

/// Emitted once when the command exits. The frontend finalises the output panel
/// from THIS rather than from the command's return value: the panel must resolve
/// even if the component that started the run has since unmounted (the working
/// panel remounts whenever the FS watcher fires, which a hook can easily
/// trigger by stashing).
#[derive(Debug, Clone, Serialize, specta::Type, tauri_specta::Event)]
pub struct CommandDone {
	pub run_id: String,
	pub exit_code: i32,
}

/// Decodes as much of `pending` as forms complete UTF-8, leaving any trailing
/// partial sequence behind for the next read.
///
/// Necessary because a 4 KiB read can land mid-character, and command output is
/// full of multi-byte glyphs (lefthook draws box borders, ✔, 🥊). Naively
/// lossy-decoding each chunk would sprinkle U+FFFD through them.
pub fn take_decodable(pending: &mut Vec<u8>) -> String {
	match std::str::from_utf8(pending) {
		Ok(s) => {
			let text = s.to_string();
			pending.clear();
			text
		}
		Err(e) => {
			let valid = e.valid_up_to();
			let text = String::from_utf8_lossy(&pending[..valid]).to_string();
			pending.drain(..valid);
			// A genuinely invalid (not merely incomplete) sequence would stall
			// here forever, so drop one byte to guarantee progress.
			if valid == 0 && e.error_len().is_some() {
				pending.remove(0);
			}
			text
		}
	}
}

/// Drains one pipe, emitting chunks as they arrive and accumulating the whole
/// stream for the caller.
fn spawn_pump<R: Read + Send + 'static>(
	app: tauri::AppHandle,
	run_id: String,
	is_stderr: bool,
	reader: Option<R>,
	sink: Arc<Mutex<String>>,
) -> std::thread::JoinHandle<()> {
	std::thread::spawn(move || {
		let Some(mut reader) = reader else {
			return;
		};
		let mut buf = [0u8; 4096];
		let mut pending: Vec<u8> = Vec::new();
		loop {
			let n = match reader.read(&mut buf) {
				Ok(0) | Err(_) => break,
				Ok(n) => n,
			};
			pending.extend_from_slice(&buf[..n]);
			let text = take_decodable(&mut pending);
			if text.is_empty() {
				continue;
			}
			if let Ok(mut acc) = sink.lock() {
				acc.push_str(&text);
			}
			let _ = CommandChunk { run_id: run_id.clone(), stderr: is_stderr, text }
				.emit(&app);
		}
	})
}

/// Runs git, streaming output via `CommandChunk` events and finishing with a
/// `CommandDone`. Returns the same `Outcome` as `run_capturing`, so a non-zero
/// exit is NOT an error — the caller decides what that means.
pub fn run_streaming(
	app: &tauri::AppHandle,
	repo_path: &str,
	args: &[&str],
	run_id: &str,
) -> Result<Outcome, GitError> {
	// Streamed commands are the hook-running ones (commit, palette), so this is
	// where it's worth waiting for the login-shell PATH — see git::env.
	crate::git::env::ensure_git_path();
	let started = Instant::now();
	let mut child = git_command(repo_path, args)
		// A hook that tries to read from stdin would hang forever otherwise —
		// there's no terminal for it to prompt on.
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.spawn()
		.map_err(|e| GitError::Spawn(e.to_string()))?;

	let out_acc = Arc::new(Mutex::new(String::new()));
	let err_acc = Arc::new(Mutex::new(String::new()));
	// Both pipes are pumped concurrently: draining only one risks the child
	// blocking on a full buffer for the other.
	let pumps = [
		spawn_pump(
			app.clone(),
			run_id.to_string(),
			false,
			child.stdout.take(),
			out_acc.clone(),
		),
		spawn_pump(
			app.clone(),
			run_id.to_string(),
			true,
			child.stderr.take(),
			err_acc.clone(),
		),
	];

	let status = child.wait().map_err(|e| GitError::Spawn(e.to_string()))?;
	for pump in pumps {
		let _ = pump.join();
	}

	let exit_code = status.code().unwrap_or(-1);
	let stdout = out_acc.lock().map(|s| s.clone()).unwrap_or_default();
	let stderr = err_acc.lock().map(|s| s.clone()).unwrap_or_default();
	record(
		app,
		GitConsoleEntry {
			id: uuid::Uuid::new_v4().to_string(),
			command: format!("git -C {} {}", repo_path, args.join(" ")),
			exit_code,
			duration_ms: started.elapsed().as_millis() as u64,
			stderr: stderr.clone(),
			timestamp_ms: std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.map(|d| d.as_millis() as i64)
				.unwrap_or(0),
		},
	);
	let _ = CommandDone { run_id: run_id.to_string(), exit_code }.emit(app);
	Ok(Outcome { exit_code, stdout, stderr })
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn decodes_complete_input_and_empties_the_buffer() {
		let mut pending = "hello".as_bytes().to_vec();

		assert_eq!(take_decodable(&mut pending), "hello");
		assert!(pending.is_empty());
	}

	/// THE case this exists for: a read boundary landing inside a multi-byte
	/// character. lefthook's output is full of them (─, ✔, 🥊), and decoding
	/// each raw chunk lossily would corrupt them.
	#[test]
	fn holds_back_a_split_multibyte_character_until_it_completes() {
		let full = "─".as_bytes().to_vec(); // 3 bytes: e2 94 80
		let mut pending = full[..2].to_vec();

		assert_eq!(take_decodable(&mut pending), "", "incomplete char must wait");
		assert_eq!(pending.len(), 2, "its bytes are kept for the next read");

		pending.push(full[2]);
		assert_eq!(take_decodable(&mut pending), "─", "completed once the rest arrives");
		assert!(pending.is_empty());
	}

	#[test]
	fn emits_the_valid_prefix_before_a_split_character() {
		let mut pending = b"ok".to_vec();
		pending.extend_from_slice(&"✔".as_bytes()[..1]);

		assert_eq!(take_decodable(&mut pending), "ok");
		assert_eq!(pending.len(), 1, "the partial char stays behind");
	}

	/// Truly invalid bytes must not wedge the pump in a loop that never
	/// consumes anything.
	#[test]
	fn makes_progress_on_invalid_bytes() {
		let mut pending = vec![0xff, b'a'];

		let first = take_decodable(&mut pending);

		assert!(pending.len() < 2, "at least one byte must be consumed");
		let second = take_decodable(&mut pending);
		assert_eq!(format!("{}{}", first, second).contains('a'), true);
		assert!(pending.is_empty());
	}
}
