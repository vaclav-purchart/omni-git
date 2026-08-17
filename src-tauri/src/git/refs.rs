use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct LocalBranch {
	pub name: String,
	pub is_head: bool,
	pub upstream: Option<String>,
	pub tip: String,
	/// Commits this branch has that its upstream doesn't, and vice versa. Both 0
	/// when in sync or when there is no upstream.
	pub ahead: u32,
	pub behind: u32,
	/// The upstream is configured but no longer exists (deleted on the remote).
	pub upstream_gone: bool,
}

/// Parses `%(upstream:track)`, which is git's own summary of the divergence:
/// `""` (in sync or no upstream), `"[ahead 2]"`, `"[behind 1]"`,
/// `"[ahead 2, behind 1]"` or `"[gone]"`.
///
/// Preferred over `%(ahead-behind:...)` (git 2.41+) and over a `rev-list` per
/// branch: it's one field in the existing for-each-ref call, and it works on
/// older git.
pub fn parse_track(field: &str) -> (u32, u32, bool) {
	let inner = field.trim().trim_start_matches('[').trim_end_matches(']');
	if inner.is_empty() {
		return (0, 0, false);
	}
	if inner == "gone" {
		return (0, 0, true);
	}
	let mut ahead = 0;
	let mut behind = 0;
	for part in inner.split(',') {
		let part = part.trim();
		if let Some(n) = part.strip_prefix("ahead ") {
			ahead = n.trim().parse().unwrap_or(0);
		} else if let Some(n) = part.strip_prefix("behind ") {
			behind = n.trim().parse().unwrap_or(0);
		}
	}
	(ahead, behind, false)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RemoteBranch {
	pub name: String,
	pub remote: String,
	pub tip: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct TagRef {
	pub name: String,
	pub tip: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct RepoRefs {
	pub local: Vec<LocalBranch>,
	pub remotes: Vec<RemoteBranch>,
	pub tags: Vec<TagRef>,
	pub current: Option<String>,
}

// for-each-ref line for locals: "<name>\x1f<head>\x1f<upstream>\x1f<tip>"
// where <head> is "*" for the checked-out branch, "" otherwise.
pub fn parse_locals(stdout: &str) -> Vec<LocalBranch> {
	stdout
		.lines()
		.filter(|l| !l.trim().is_empty())
		.map(|l| {
			let f: Vec<&str> = l.split('\u{1f}').collect();
			let name = f.first().copied().unwrap_or("").to_string();
			let is_head = f.get(1).copied().unwrap_or("") == "*";
			let up = f.get(2).copied().unwrap_or("");
			let upstream = if up.is_empty() {
				None
			} else {
				Some(up.to_string())
			};
			let tip = f.get(3).copied().unwrap_or("").to_string();
			let (ahead, behind, upstream_gone) =
				parse_track(f.get(4).copied().unwrap_or(""));
			LocalBranch {
				name,
				is_head,
				upstream,
				tip,
				ahead,
				behind,
				upstream_gone,
			}
		})
		.collect()
}

// Remote short names like "origin/main"; skip the "<remote>/HEAD" symbolic ref.
// Line format: "<name>\x1f<tip>".
pub fn parse_remotes(stdout: &str) -> Vec<RemoteBranch> {
	stdout
		.lines()
		.map(|l| l.trim())
		.filter(|l| !l.is_empty())
		.filter_map(|l| {
			let f: Vec<&str> = l.split('\u{1f}').collect();
			let name = f.first().copied().unwrap_or("").to_string();
			if name.ends_with("/HEAD") {
				return None;
			}
			let tip = f.get(1).copied().unwrap_or("").to_string();
			let remote = name.split('/').next().unwrap_or("").to_string();
			Some(RemoteBranch { name, remote, tip })
		})
		.collect()
}

// Line format: "<name>\x1f<objectname>\x1f<*objectname>" where the deref field
// is only non-empty for annotated tags (pointing at the tagged commit).
pub fn parse_tags(stdout: &str) -> Vec<TagRef> {
	stdout
		.lines()
		.filter(|l| !l.trim().is_empty())
		.map(|l| {
			let f: Vec<&str> = l.split('\u{1f}').collect();
			let name = f.first().copied().unwrap_or("").to_string();
			let object = f.get(1).copied().unwrap_or("");
			let deref = f.get(2).copied().unwrap_or("");
			let tip = if deref.is_empty() {
				object.to_string()
			} else {
				deref.to_string()
			};
			TagRef { name, tip }
		})
		.collect()
}

pub fn list_refs(app: &tauri::AppHandle, repo_path: &str) -> Result<RepoRefs, GitError> {
	let locals_out = run(
		app,
		repo_path,
		&[
			"for-each-ref",
			"--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(objectname)%1f%(upstream:track)",
			"refs/heads",
		],
	)?;
	let remotes_out = run(
		app,
		repo_path,
		&[
			"for-each-ref",
			"--format=%(refname:short)%1f%(objectname)",
			"refs/remotes",
		],
	)?;
	let tags_out = run(
		app,
		repo_path,
		&[
			"for-each-ref",
			"--format=%(refname:short)%1f%(objectname)%1f%(*objectname)",
			"refs/tags",
		],
	)?;
	let local = parse_locals(&locals_out);
	let current = local.iter().find(|b| b.is_head).map(|b| b.name.clone());
	Ok(RepoRefs {
		local,
		remotes: parse_remotes(&remotes_out),
		tags: parse_tags(&tags_out),
		current,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_track_in_sync_or_no_upstream() {
		assert_eq!(parse_track(""), (0, 0, false));
		assert_eq!(parse_track("   "), (0, 0, false));
	}

	#[test]
	fn parse_track_ahead_behind_and_both() {
		assert_eq!(parse_track("[ahead 2]"), (2, 0, false));
		assert_eq!(parse_track("[behind 3]"), (0, 3, false));
		assert_eq!(parse_track("[ahead 2, behind 3]"), (2, 3, false));
	}

	/// A deleted upstream is NOT "in sync" — the UI needs to say so rather than
	/// showing nothing.
	#[test]
	fn parse_track_gone() {
		assert_eq!(parse_track("[gone]"), (0, 0, true));
	}

	#[test]
	fn parse_track_ignores_nonsense() {
		assert_eq!(parse_track("[ahead many]"), (0, 0, false));
		assert_eq!(parse_track("[weird]"), (0, 0, false));
	}

	#[test]
	fn parses_locals_with_head_and_upstream() {
		let out =
			"main\u{1f}*\u{1f}origin/main\u{1f}hMain\nfeature\u{1f}\u{1f}\u{1f}hFeature\n";
		let locals = parse_locals(out);
		assert_eq!(locals.len(), 2);
		assert_eq!(locals[0].name, "main");
		assert!(locals[0].is_head);
		assert_eq!(locals[0].upstream.as_deref(), Some("origin/main"));
		assert_eq!(locals[0].tip, "hMain");
		assert_eq!(locals[1].name, "feature");
		assert!(!locals[1].is_head);
		assert_eq!(locals[1].upstream, None);
		assert_eq!(locals[1].tip, "hFeature");
	}

	#[test]
	fn parses_remotes_and_skips_head_pointer() {
		let out = "origin/HEAD\u{1f}hHead\norigin/main\u{1f}hOriginMain\nupstream/dev\u{1f}hUpstreamDev\n";
		let remotes = parse_remotes(out);
		assert_eq!(remotes.len(), 2);
		assert_eq!(remotes[0].name, "origin/main");
		assert_eq!(remotes[0].remote, "origin");
		assert_eq!(remotes[0].tip, "hOriginMain");
		assert_eq!(remotes[1].remote, "upstream");
		assert_eq!(remotes[1].tip, "hUpstreamDev");
	}

	#[test]
	fn parses_tags() {
		// Lightweight tag: only objectname is set, deref is empty.
		// Annotated tag: deref (*objectname) points at the tagged commit.
		let out = "v1.0\u{1f}hV1Tag\u{1f}\nv1.1\u{1f}hV1_1Obj\u{1f}hV1_1Commit\n";
		let tags = parse_tags(out);
		assert_eq!(tags.len(), 2);
		assert_eq!(tags[0].name, "v1.0");
		assert_eq!(tags[0].tip, "hV1Tag");
		assert_eq!(tags[1].name, "v1.1");
		assert_eq!(tags[1].tip, "hV1_1Commit");
		assert!(parse_tags("").is_empty());
	}
}
