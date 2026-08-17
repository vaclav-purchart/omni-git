//! Opening the user's terminal at a directory.
//!
//! There is no portable way to do this, so the argv is built per platform and the
//! whole thing is overridable by a setting — no built-in list will ever cover
//! everyone's terminal.
//!
//! The argv building is pure and takes the platform as a parameter, so all three
//! platforms are testable from any one of them (this is developed on macOS, and
//! the Windows/Linux argv would otherwise be guesswork nobody ever checks).

use crate::git::palette::tokenize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
	Mac,
	Windows,
	Linux,
}

pub fn current_os() -> Os {
	if cfg!(target_os = "macos") {
		Os::Mac
	} else if cfg!(target_os = "windows") {
		Os::Windows
	} else {
		Os::Linux
	}
}

/// Placeholder for the directory in a custom command. If absent, the directory
/// is appended instead — `ghostty` and friends mostly accept a trailing path, and
/// requiring the placeholder would make the common case fiddly.
const DIR_PLACEHOLDER: &str = "{dir}";

/// Expands a user-provided terminal command.
///
/// Quoting follows the same rules as the command palette (see `tokenize`), since
/// no shell is involved here either — a path with spaces must survive as one
/// argument.
pub fn custom_argv(command: &str, dir: &str) -> Result<Vec<String>, String> {
	let tokens = tokenize(command)?;
	if tokens.is_empty() {
		return Err("Terminal command is empty".to_string());
	}
	let mut used_placeholder = false;
	let mut argv: Vec<String> = tokens
		.into_iter()
		.map(|t| {
			if t.contains(DIR_PLACEHOLDER) {
				used_placeholder = true;
				t.replace(DIR_PLACEHOLDER, dir)
			} else {
				t
			}
		})
		.collect();
	if !used_placeholder {
		argv.push(dir.to_string());
	}
	Ok(argv)
}

/// Candidate argvs for Linux, in preference order.
///
/// Every desktop has a different terminal and they disagree about the
/// working-directory flag, so the caller tries each in turn and uses the first
/// whose program actually exists.
pub fn linux_candidates(dir: &str) -> Vec<Vec<String>> {
	let d = dir.to_string();
	vec![
		vec!["ghostty".into(), format!("--working-directory={d}")],
		vec!["wezterm".into(), "start".into(), "--cwd".into(), d.clone()],
		vec!["kitty".into(), "--directory".into(), d.clone()],
		vec!["alacritty".into(), "--working-directory".into(), d.clone()],
		vec!["gnome-terminal".into(), format!("--working-directory={d}")],
		vec!["konsole".into(), "--workdir".into(), d.clone()],
		vec!["xfce4-terminal".into(), format!("--working-directory={d}")],
		vec!["x-terminal-emulator".into(), format!("--working-directory={d}")],
	]
}

/// The argv to run, given the platform and an optional user override.
///
/// `program_exists` is injected so the Linux candidate search is testable without
/// depending on what happens to be installed.
pub fn terminal_argv(
	os: Os,
	custom: Option<&str>,
	dir: &str,
	program_exists: &dyn Fn(&str) -> bool,
) -> Result<Vec<String>, String> {
	if let Some(command) = custom.map(str::trim).filter(|c| !c.is_empty()) {
		return custom_argv(command, dir);
	}
	match os {
		// `open -a` hands off to LaunchServices, which is the only approach that
		// works for every terminal app without knowing its CLI.
		Os::Mac => Ok(vec![
			"open".into(),
			"-a".into(),
			"Terminal".into(),
			dir.to_string(),
		]),
		// `start` needs an empty title argument, or it treats the first quoted
		// argument as the window title and never launches anything.
		Os::Windows => Ok(vec![
			"cmd".into(),
			"/C".into(),
			"start".into(),
			"".into(),
			"cmd".into(),
			"/K".into(),
			format!("cd /D \"{dir}\""),
		]),
		Os::Linux => linux_candidates(dir)
			.into_iter()
			.find(|argv| program_exists(&argv[0]))
			.ok_or_else(|| {
				"No known terminal found. Set a terminal command in Help."
					.to_string()
			}),
	}
}

/// Whether `program` can be found on the PATH we give subprocesses.
fn program_exists(program: &str) -> bool {
	// An explicit path is checked directly; anything else is searched for.
	if program.contains('/') || program.contains('\\') {
		return std::path::Path::new(program).exists();
	}
	let path = crate::git::env::git_path()
		.map(|p| p.to_string())
		.or_else(|| std::env::var("PATH").ok())
		.unwrap_or_default();
	let separator = if cfg!(windows) { ';' } else { ':' };
	path.split(separator)
		.filter(|dir| !dir.is_empty())
		.any(|dir| std::path::Path::new(dir).join(program).exists())
}

/// Launches a terminal at `dir`, detached.
///
/// Deliberately does NOT wait or capture output: the terminal outlives this call,
/// and waiting would block until the user closed it.
pub fn open_terminal(dir: &str, custom: Option<&str>) -> Result<(), String> {
	if !std::path::Path::new(dir).is_dir() {
		return Err(format!("Not a directory: {dir}"));
	}
	// Hook-running commands wait for the enriched PATH; so does this, since the
	// user's terminal is very likely installed somewhere only their shell knows.
	crate::git::env::ensure_git_path();
	let argv = terminal_argv(current_os(), custom, dir, &program_exists)?;
	let mut cmd = std::process::Command::new(&argv[0]);
	cmd.args(&argv[1..]);
	if let Some(path) = crate::git::env::git_path() {
		cmd.env("PATH", path);
	}
	cmd.stdin(std::process::Stdio::null())
		.stdout(std::process::Stdio::null())
		.stderr(std::process::Stdio::null());
	cmd.spawn()
		.map(|_child| ())
		.map_err(|e| format!("Could not start {}: {e}", argv[0]))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn none_exist(_: &str) -> bool {
		false
	}
	fn all_exist(_: &str) -> bool {
		true
	}

	#[test]
	fn mac_default_uses_launch_services() {
		let argv = terminal_argv(Os::Mac, None, "/repo", &none_exist).unwrap();

		assert_eq!(argv, ["open", "-a", "Terminal", "/repo"]);
	}

	/// Without the empty title argument, `start` treats a quoted argument as the
	/// window title and opens nothing.
	#[test]
	fn windows_default_passes_an_empty_start_title() {
		let argv = terminal_argv(Os::Windows, None, "C:\\repo", &none_exist).unwrap();

		assert_eq!(argv[0..4], ["cmd", "/C", "start", ""]);
		assert!(argv.last().unwrap().contains("C:\\repo"));
	}

	#[test]
	fn linux_picks_the_first_installed_candidate() {
		let only_konsole = |p: &str| p == "konsole";

		let argv = terminal_argv(Os::Linux, None, "/repo", &only_konsole).unwrap();

		assert_eq!(argv, ["konsole", "--workdir", "/repo"]);
	}

	#[test]
	fn linux_prefers_earlier_candidates() {
		let argv = terminal_argv(Os::Linux, None, "/repo", &all_exist).unwrap();

		assert_eq!(argv[0], "ghostty");
	}

	/// Better an actionable message than silently doing nothing.
	#[test]
	fn linux_with_no_terminal_explains_itself() {
		let err = terminal_argv(Os::Linux, None, "/repo", &none_exist).unwrap_err();

		assert!(err.contains("terminal command"), "got {err}");
	}

	#[test]
	fn a_custom_command_wins_on_every_platform() {
		for os in [Os::Mac, Os::Windows, Os::Linux] {
			let argv = terminal_argv(os, Some("myterm --here {dir}"), "/repo", &none_exist)
				.unwrap();
			assert_eq!(argv, ["myterm", "--here", "/repo"], "{os:?}");
		}
	}

	/// The common case: no placeholder, so the directory is appended.
	#[test]
	fn a_custom_command_without_a_placeholder_gets_the_dir_appended() {
		assert_eq!(
			custom_argv("ghostty", "/repo").unwrap(),
			["ghostty", "/repo"]
		);
	}

	#[test]
	fn a_custom_command_can_place_the_dir_anywhere() {
		assert_eq!(
			custom_argv("wezterm start --cwd {dir} -- htop", "/repo").unwrap(),
			["wezterm", "start", "--cwd", "/repo", "--", "htop"]
		);
	}

	/// No shell is involved, so a path with spaces has to survive as ONE argument
	/// — the same reason the command palette tokenises rather than word-splitting.
	#[test]
	fn a_quoted_custom_command_keeps_arguments_together() {
		assert_eq!(
			custom_argv("open -a \"iTerm 2\" {dir}", "/my repo").unwrap(),
			["open", "-a", "iTerm 2", "/my repo"]
		);
	}

	#[test]
	fn an_unquotable_custom_command_is_rejected() {
		assert!(custom_argv("myterm \"oops", "/repo").is_err());
	}

	#[test]
	fn blank_custom_falls_back_to_the_platform_default() {
		let argv = terminal_argv(Os::Mac, Some("   "), "/repo", &none_exist).unwrap();

		assert_eq!(argv[0], "open");
	}
}
