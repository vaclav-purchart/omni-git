//! Running an arbitrary git command typed by the user (the command palette).
//!
//! The input is tokenised HERE rather than handed to a shell: `run` never goes
//! through one, so quoting is our job and there is no shell to inject into. A
//! commit message with spaces, quotes or `$` therefore reaches git as a single
//! argument, exactly as typed.

use crate::git::run::{GitError, Outcome};
use crate::git::stream::run_streaming;

/// Splits a command line into argv, honouring quotes the way a shell would.
///
/// Errors (rather than guessing) on an unterminated quote or a trailing
/// backslash: silently running a differently-quoted command than what's on
/// screen is worse than refusing.
///
/// Shared with the terminal-command setting, which needs the same quoting rules
/// for the same reason — no shell is involved there either.
pub fn tokenize(input: &str) -> Result<Vec<String>, String> {
	let mut args: Vec<String> = Vec::new();
	let mut current = String::new();
	let mut has_current = false;
	let mut chars = input.chars().peekable();
	// None = outside quotes; Some(q) = inside a q-quoted run.
	let mut quote: Option<char> = None;

	while let Some(c) = chars.next() {
		match c {
			'\\' => {
				// Backslash is literal inside single quotes, an escape elsewhere.
				if quote == Some('\'') {
					current.push(c);
					has_current = true;
				} else {
					let next = chars.next().ok_or("Command ends with a backslash")?;
					current.push(next);
					has_current = true;
				}
			}
			'\'' | '"' => match quote {
				Some(q) if q == c => quote = None,
				Some(_) => {
					current.push(c);
					has_current = true;
				}
				None => {
					quote = Some(c);
					// An empty "" or '' is still an argument.
					has_current = true;
				}
			},
			c if c.is_whitespace() && quote.is_none() => {
				if has_current {
					args.push(std::mem::take(&mut current));
					has_current = false;
				}
			}
			c => {
				current.push(c);
				has_current = true;
			}
		}
	}
	if quote.is_some() {
		return Err("Unterminated quote".to_string());
	}
	if has_current {
		args.push(current);
	}
	Ok(args)
}

/// `tokenize`, plus dropping a leading `git` (typing it is natural) and
/// rejecting an empty command.
pub fn parse_git_args(input: &str) -> Result<Vec<String>, String> {
	let mut args = tokenize(input)?;
	if args.first().map(|a| a == "git").unwrap_or(false) {
		args.remove(0);
	}
	if args.is_empty() {
		return Err("Enter a git command".to_string());
	}
	Ok(args)
}

/// Runs a user-typed git command, streaming its output.
///
/// A parse failure comes back as `GitError::Spawn` — "we couldn't run this" —
/// carrying the reason for the UI to show.
pub fn run_command(
	app: &tauri::AppHandle,
	repo_path: &str,
	input: &str,
	run_id: &str,
) -> Result<Outcome, GitError> {
	let args = parse_git_args(input).map_err(GitError::Spawn)?;
	let argv: Vec<&str> = args.iter().map(String::as_str).collect();
	run_streaming(app, repo_path, &argv, run_id)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn splits_on_whitespace() {
		assert_eq!(parse_git_args("checkout main").unwrap(), ["checkout", "main"]);
	}

	/// Typing the `git` prefix is the natural thing to do, so both forms work.
	#[test]
	fn drops_a_leading_git() {
		assert_eq!(parse_git_args("git status").unwrap(), ["status"]);
		assert_eq!(parse_git_args("status").unwrap(), ["status"]);
	}

	/// Only the FIRST token: `git log git` is asking about a path named "git".
	#[test]
	fn drops_only_the_leading_git() {
		assert_eq!(parse_git_args("log git").unwrap(), ["log", "git"]);
	}

	#[test]
	fn collapses_extra_whitespace() {
		assert_eq!(parse_git_args("  checkout   main  ").unwrap(), ["checkout", "main"]);
	}

	/// The case that makes tokenising here (rather than word-splitting in the UI)
	/// necessary: a quoted message is ONE argument.
	#[test]
	fn keeps_a_quoted_argument_together() {
		assert_eq!(
			parse_git_args("commit -m \"my message here\"").unwrap(),
			["commit", "-m", "my message here"]
		);
		assert_eq!(
			parse_git_args("commit -m 'my message here'").unwrap(),
			["commit", "-m", "my message here"]
		);
	}

	/// Inside single quotes everything is literal — backslashes, `$`, and double
	/// quotes. (As in a shell, a single quote itself cannot be escaped in there,
	/// which is why this example doesn't contain one.)
	#[test]
	fn single_quotes_are_literal_inside() {
		assert_eq!(
			parse_git_args(r#"commit -m 'has \ and $HOME and "dq"'"#).unwrap(),
			["commit", "-m", r#"has \ and $HOME and "dq""#]
		);
	}

	#[test]
	fn escapes_outside_quotes() {
		assert_eq!(parse_git_args("show my\\ file.txt").unwrap(), ["show", "my file.txt"]);
		assert_eq!(parse_git_args("commit -m \\\"hi\\\"").unwrap(), ["commit", "-m", "\"hi\""]);
	}

	#[test]
	fn escaped_quote_inside_double_quotes() {
		assert_eq!(
			parse_git_args("commit -m \"say \\\"hi\\\"\"").unwrap(),
			["commit", "-m", "say \"hi\""]
		);
	}

	/// An explicitly empty argument is meaningful (e.g. an empty message).
	#[test]
	fn keeps_an_explicitly_empty_argument() {
		assert_eq!(parse_git_args("commit -m \"\"").unwrap(), ["commit", "-m", ""]);
	}

	// Refusing beats running something other than what's on screen.
	#[test]
	fn rejects_an_unterminated_quote() {
		assert_eq!(parse_git_args("commit -m \"oops").unwrap_err(), "Unterminated quote");
		assert_eq!(parse_git_args("commit -m 'oops").unwrap_err(), "Unterminated quote");
	}

	#[test]
	fn rejects_a_trailing_backslash() {
		assert!(parse_git_args("show foo\\").is_err());
	}

	#[test]
	fn rejects_empty_input() {
		assert!(parse_git_args("").is_err());
		assert!(parse_git_args("   ").is_err());
		// `git` alone leaves nothing to run.
		assert!(parse_git_args("git").is_err());
	}

	/// No shell is involved, so these are ordinary characters in an argument —
	/// not operators. Worth pinning: it's the reason a palette like this isn't a
	/// shell-injection surface.
	#[test]
	fn shell_metacharacters_stay_literal() {
		assert_eq!(
			parse_git_args("commit -m hi;rm_-rf_/ && echo").unwrap(),
			["commit", "-m", "hi;rm_-rf_/", "&&", "echo"]
		);
	}
}
