use crate::git::run::{run, GitError};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct CommitSummary {
	pub hash: String,
	pub parents: Vec<String>,
	pub author_name: String,
	pub author_email: String,
	pub timestamp_ms: i64,
	pub refs: Vec<String>,
	pub subject: String,
}

// Field sep = US (0x1f), record sep = RS (0x1e). Order must match parse_line.
const FORMAT: &str = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e";

fn parse_line(record: &str) -> Option<CommitSummary> {
	let f: Vec<&str> = record.split('\u{1f}').collect();
	if f.len() < 7 {
		return None;
	}
	let parents = if f[1].trim().is_empty() {
		Vec::new()
	} else {
		f[1].split_whitespace().map(|s| s.to_string()).collect()
	};
	let refs = if f[5].trim().is_empty() {
		Vec::new()
	} else {
		f[5].split(", ").map(|s| s.trim().to_string()).collect()
	};
	let timestamp_ms = f[4].trim().parse::<i64>().unwrap_or(0) * 1000;
	Some(CommitSummary {
		hash: f[0].to_string(),
		parents,
		author_name: f[2].to_string(),
		author_email: f[3].to_string(),
		timestamp_ms,
		refs,
		subject: f[6].to_string(),
	})
}

pub fn parse_log(stdout: &str) -> Vec<CommitSummary> {
	stdout
		.split('\u{1e}')
		.map(|r| r.trim_matches('\n'))
		.filter(|r| !r.is_empty())
		.filter_map(parse_line)
		.collect()
}

pub fn log_commits(
	app: &tauri::AppHandle,
	repo_path: &str,
	all: bool,
	skip: u32,
	limit: u32,
) -> Result<Vec<CommitSummary>, GitError> {
	let format_arg = format!("--pretty=format:{}", FORMAT);
	let skip_arg = format!("--skip={}", skip);
	let max_arg = format!("--max-count={}", limit);
	let mut args: Vec<&str> = vec![
		"log",
		"--topo-order",
		"--decorate=full",
		&format_arg,
		&skip_arg,
		&max_arg,
	];
	if all {
		args.push("--all");
	}
	let stdout = run(app, repo_path, &args)?;
	Ok(parse_log(&stdout))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_a_record_with_refs_and_parents() {
		let rec = "abc123\u{1f}p1 p2\u{1f}Ada\u{1f}ada@x.io\u{1f}1700000000\u{1f}HEAD -> main, origin/main\u{1f}Add thing\u{1e}";
		let out = parse_log(rec);
		assert_eq!(out.len(), 1);
		let c = &out[0];
		assert_eq!(c.hash, "abc123");
		assert_eq!(c.parents, vec!["p1", "p2"]);
		assert_eq!(c.author_name, "Ada");
		assert_eq!(c.timestamp_ms, 1_700_000_000_000);
		assert_eq!(c.refs, vec!["HEAD -> main", "origin/main"]);
		assert_eq!(c.subject, "Add thing");
	}

	#[test]
	fn root_commit_has_no_parents_and_empty_refs() {
		let rec = "root1\u{1f}\u{1f}Bob\u{1f}b@x.io\u{1f}1699999999\u{1f}\u{1f}init\u{1e}";
		let c = &parse_log(rec)[0];
		assert!(c.parents.is_empty());
		assert!(c.refs.is_empty());
		assert_eq!(c.subject, "init");
	}

	#[test]
	fn empty_output_yields_no_commits() {
		assert!(parse_log("").is_empty());
	}

	#[test]
	fn parses_full_decorated_refs() {
		let rec = "h\u{1f}p\u{1f}A\u{1f}a@x\u{1f}1700000000\u{1f}HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1\u{1f}subj\u{1e}";
		let c = &parse_log(rec)[0];
		assert_eq!(
			c.refs,
			vec![
				"HEAD -> refs/heads/main",
				"refs/remotes/origin/main",
				"tag: refs/tags/v1",
			]
		);
	}
}
