use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct Stash {
	pub selector: String,
	pub message: String,
}

// `git stash list --format=%gd%x1f%s` → "stash@{0}\x1f<message>".
pub fn parse_stashes(stdout: &str) -> Vec<Stash> {
	stdout
		.lines()
		.filter(|l| !l.trim().is_empty())
		.map(|l| {
			let mut parts = l.splitn(2, '\u{1f}');
			let selector = parts.next().unwrap_or("").to_string();
			let message = parts.next().unwrap_or("").to_string();
			Stash { selector, message }
		})
		.collect()
}

pub fn list_stashes(app: &tauri::AppHandle, repo_path: &str) -> Result<Vec<Stash>, GitError> {
	let out = run(app, repo_path, &["stash", "list", "--format=%gd%x1f%s"])?;
	Ok(parse_stashes(&out))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_stashes() {
		let out = "stash@{0}\u{1f}WIP on main: abc feature\nstash@{1}\u{1f}On dev: fix\n";
		let s = parse_stashes(out);
		assert_eq!(s.len(), 2);
		assert_eq!(s[0].selector, "stash@{0}");
		assert_eq!(s[0].message, "WIP on main: abc feature");
		assert_eq!(s[1].selector, "stash@{1}");
	}

	#[test]
	fn empty_yields_none() {
		assert!(parse_stashes("").is_empty());
	}
}
