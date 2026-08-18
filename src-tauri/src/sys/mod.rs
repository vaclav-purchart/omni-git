pub mod terminal;

use std::process::Command;

/// Stops a spawned console program from showing a window on Windows.
///
/// The app is a GUI-subsystem binary (see `main.rs`), so it owns no console —
/// which means Windows creates, and SHOWS, a fresh console for every console
/// child it starts. With a git invocation behind every refresh that is a command
/// prompt window blinking constantly, each one costing about a second to appear
/// and disappear. `CREATE_NO_WINDOW` gives the child a console that is never
/// displayed; pipes are unaffected, and every caller here captures output rather
/// than expecting a terminal.
///
/// Deliberately NOT used by `sys::terminal`, where the window is the whole point.
pub(crate) fn hide_console(cmd: &mut Command) {
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		/// <https://learn.microsoft.com/windows/win32/procthread/process-creation-flags>
		const CREATE_NO_WINDOW: u32 = 0x0800_0000;
		cmd.creation_flags(CREATE_NO_WINDOW);
	}
	#[cfg(not(windows))]
	{
		// Nothing to hide anywhere else; the no-op keeps call sites unconditional.
		let _ = cmd;
	}
}

#[cfg(test)]
mod tests {
	use std::path::{Path, PathBuf};

	/// Spawn sites that deliberately leave a console alone, and why.
	const EXCUSED: &[(&str, &str)] = &[
		(
			"sys/terminal.rs",
			"launches the user's terminal — the window IS the point",
		),
		(
			"git/env.rs",
			"unix-only login-shell probe; never compiled on Windows",
		),
	];

	fn rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
		for entry in std::fs::read_dir(dir).unwrap() {
			let path = entry.unwrap().path();
			if path.is_dir() {
				rs_files(&path, out);
			} else if path.extension().is_some_and(|e| e == "rs") {
				out.push(path);
			}
		}
	}

	/// Every production spawn must hide its console, or be excused above.
	///
	/// This is a source check rather than a behavioural one because the failure it
	/// guards is invisible from anywhere but Windows — and `cargo test` cannot run
	/// on Windows in this crate at all (see `crate::export_bindings`). A new
	/// `Command::new` that forgets `hide_console` brings the flashing prompt
	/// windows straight back, and nothing else would notice.
	#[test]
	fn every_production_spawn_hides_its_console() {
		let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
		let mut files = Vec::new();
		rs_files(&src, &mut files);

		let mut offenders = Vec::new();
		for file in files {
			let rel = file
				.strip_prefix(&src)
				.unwrap()
				.to_string_lossy()
				.replace('\\', "/");
			if EXCUSED.iter().any(|(excused, _)| *excused == rel) {
				continue;
			}
			let text = std::fs::read_to_string(&file).unwrap();
			// Everything from the first `#[cfg(test)]` onwards is test support, which
			// never runs inside the app.
			let production = text.split("#[cfg(test)]").next().unwrap();
			let lines: Vec<&str> = production.lines().collect();
			for (i, line) in lines.iter().enumerate() {
				if !line.contains("Command::new") {
					continue;
				}
				let window = lines[i..lines.len().min(i + 20)].join("\n");
				if !window.contains("hide_console") {
					offenders.push(format!("{rel}:{}", i + 1));
				}
			}
		}

		assert!(
			offenders.is_empty(),
			"these would flash a console window on Windows — call sys::hide_console: {offenders:?}"
		);
	}
}
