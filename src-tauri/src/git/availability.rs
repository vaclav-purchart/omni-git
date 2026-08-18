use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct GitStatus {
	pub available: bool,
	pub version: Option<String>,
}

/// Runs `git --version`. `available` is true only on a zero exit with parseable output.
pub fn check_git() -> GitStatus {
	let mut cmd = Command::new("git");
	crate::sys::hide_console(&mut cmd);
	match cmd.arg("--version").output() {
		Ok(out) if out.status.success() => {
			let version = String::from_utf8_lossy(&out.stdout)
				.trim()
				.strip_prefix("git version ")
				.map(|s| s.to_string());
			GitStatus { available: version.is_some(), version }
		}
		_ => GitStatus { available: false, version: None },
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn detects_system_git() {
		// CI and dev machines have git installed.
		let status = check_git();
		assert!(status.available, "expected system git to be available");
		assert!(status.version.is_some());
	}
}
