//! PATH resolution for git subprocesses.
//!
//! A macOS `.app` launched from Finder or the Dock inherits launchd's
//! environment, not the user's shell — in practice `PATH=/usr/bin:/bin:/usr/sbin:/sbin`.
//! git itself lives in `/usr/bin`, so most things work and the problem stays
//! hidden until a **hook** shells out: `lefthook` → `lint-staged` → `yarn` dies
//! with `sh: yarn: command not found`, because homebrew (`/opt/homebrew/bin`),
//! nvm (`~/.nvm/versions/node/*/bin`) and volta all live on the shell's PATH
//! and nowhere else.
//!
//! So we ask the user's login shell what PATH it would use and hand that to
//! every git invocation. `-i` **and** `-l` are both needed: homebrew's
//! `brew shellenv` is conventionally in `.zprofile` (login), while nvm/volta
//! setup is in `.zshrc` (interactive).

use std::sync::{Mutex, OnceLock};

/// Sentinel around the PATH we print. Interactive rc files routinely echo
/// banners and version notices, so the value has to be delimited rather than
/// assumed to be the whole of stdout.
const MARKER: &str = "__OMNI_GIT_PATH__";

/// Pulls the PATH out of a login shell's stdout, ignoring any surrounding
/// noise from rc files.
pub fn extract_marked_path(stdout: &str) -> Option<String> {
	let start = stdout.find(MARKER)? + MARKER.len();
	let rest = &stdout[start..];
	let end = rest.find(MARKER)?;
	let path = rest[..end].trim();
	if path.is_empty() {
		None
	} else {
		Some(path.to_string())
	}
}

/// Login-shell entries first, then any inherited entry not already present, so
/// resolution can only ever ADD directories. Duplicates and empty segments are
/// dropped — an empty segment in PATH means "current directory", which is a
/// mild security footgun we don't want to propagate.
pub fn merge_paths(login: &str, inherited: &str) -> String {
	let mut seen = std::collections::HashSet::new();
	login
		.split(':')
		.chain(inherited.split(':'))
		.filter(|s| !s.is_empty())
		.filter(|s| seen.insert(s.to_string()))
		.collect::<Vec<_>>()
		.join(":")
}

/// Asks `$SHELL` for its PATH. `None` if there's no `$SHELL`, the shell can't
/// be run, or it doesn't answer within the timeout.
///
/// The timeout guards against a pathological rc file that blocks forever (some
/// wait on network or prompt for input); we'd rather run with the inherited PATH
/// than hang every git command. A timed-out shell is left to exit on its own —
/// it can't be killed from here once moved into the worker thread, and it is a
/// single short-lived process at startup.
/// The script that makes a shell print its PATH, or `None` for shells we can't
/// safely ask.
///
/// Not every `$SHELL` is POSIX. In **fish** `$PATH` is a list, so `"$PATH"`
/// would come back space-separated and useless; it needs `string join`.
/// **nushell** and friends have neither `printf` nor `$VAR` expansion in this
/// form, so we decline and keep the inherited PATH rather than feed garbage into
/// the merge.
pub fn probe_script(shell: &str) -> Option<String> {
	let name = std::path::Path::new(shell)
		.file_name()
		.map(|n| n.to_string_lossy().to_string())
		.unwrap_or_else(|| shell.to_string());
	match name.as_str() {
		"fish" => Some(format!(
			"printf '{m}%s{m}' (string join : $PATH)",
			m = MARKER
		)),
		"nu" | "elvish" | "xonsh" | "pwsh" | "powershell" => None,
		// sh, bash, zsh, dash, ksh, ash …
		_ => Some(format!("printf '{m}%s{m}' \"$PATH\"", m = MARKER)),
	}
}

/// The shell to ask. launchd normally does export `SHELL` to GUI apps, but not
/// guaranteeably (it's absent under some launch paths and in `env -i`
/// scenarios), and if we can't determine a shell there's no point resolving —
/// so fall back to the first plausible one that actually exists rather than
/// giving up on the fix.
#[cfg(all(unix, not(test)))]
fn shell_to_probe() -> Option<String> {
	if let Some(s) = std::env::var("SHELL").ok().filter(|s| !s.is_empty()) {
		return Some(s);
	}
	["/bin/zsh", "/bin/bash", "/bin/sh"]
		.into_iter()
		.find(|p| std::path::Path::new(p).exists())
		.map(|p| p.to_string())
}

#[cfg(all(unix, not(test)))]
fn resolve_login_path() -> Option<String> {
	let shell = shell_to_probe()?;
	let script = probe_script(&shell)?;
	let (tx, rx) = std::sync::mpsc::channel();
	std::thread::spawn(move || {
		let out = std::process::Command::new(&shell)
			// Separate flags rather than a bundled `-ilc`: fish parses these
			// individually. `-l` picks up .zprofile (homebrew), `-i` picks up
			// .zshrc (nvm, volta).
			.args(["-i", "-l", "-c", &script])
			// No tty and no inherited stdin: an interactive shell must never
			// block waiting to read something.
			.stdin(std::process::Stdio::null())
			.stderr(std::process::Stdio::null())
			.output();
		let _ = tx.send(out.ok().map(|o| String::from_utf8_lossy(&o.stdout).to_string()));
	});
	let stdout = rx.recv_timeout(std::time::Duration::from_secs(3)).ok()??;
	extract_marked_path(&stdout)
}

/// Windows has no login-shell PATH convention to consult, and in tests we skip
/// resolution so unit tests neither spawn shells nor depend on the developer's
/// dotfiles. The logic worth testing is `extract_marked_path` / `merge_paths`.
#[cfg(any(not(unix), test))]
fn resolve_login_path() -> Option<String> {
	None
}

static PATH: OnceLock<Option<String>> = OnceLock::new();
/// Ensures only one thread pays for the shell, without making the others wait
/// for it the way `OnceLock::get_or_init` would.
static RESOLVING: Mutex<()> = Mutex::new(());

fn resolve_into_cache() {
	if PATH.get().is_some() {
		return;
	}
	let _guard = RESOLVING.lock().unwrap_or_else(|e| e.into_inner());
	if PATH.get().is_some() {
		return;
	}
	let resolved = resolve_login_path().map(|login| {
		let inherited = std::env::var("PATH").unwrap_or_default();
		merge_paths(&login, &inherited)
	});
	let _ = PATH.set(resolved);
}

/// Starts resolution in the background, at startup.
pub fn prewarm_git_path() {
	std::thread::spawn(resolve_into_cache);
}

/// The PATH to give git subprocesses, or `None` to leave the inherited
/// environment alone.
///
/// Deliberately does NOT wait for resolution. Spawning an interactive login
/// shell can take the better part of a second on a heavy `.zshrc`, and blocking
/// here meant every git command at startup queued behind it — the app sat there
/// before showing the repo. Reads (`log`, `status`, `for-each-ref`) don't run
/// hooks, so the inherited PATH is fine for them; commands that DO run hooks call
/// `ensure_git_path` first.
pub fn git_path() -> Option<&'static str> {
	PATH.get().and_then(|p| p.as_deref())
}

/// Waits for resolution, for commands that can run hooks (commit, push, and
/// anything from the command palette) — those are the ones that need homebrew /
/// nvm / volta on PATH, and they're user-initiated rather than on the startup
/// path, so a one-off wait is acceptable there.
pub fn ensure_git_path() {
	resolve_into_cache();
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn extracts_path_between_markers() {
		let out = format!("{m}/opt/homebrew/bin:/usr/bin{m}", m = MARKER);

		assert_eq!(
			extract_marked_path(&out).as_deref(),
			Some("/opt/homebrew/bin:/usr/bin")
		);
	}

	/// The reason for the markers: interactive rc files print banners, nvm
	/// notices, "Last login:" lines and so on, before and after our value.
	#[test]
	fn ignores_noise_printed_by_rc_files() {
		let out = format!(
			"Welcome!\nnvm: using node v24\n{m}/opt/homebrew/bin{m}\ntrailing junk\n",
			m = MARKER
		);

		assert_eq!(extract_marked_path(&out).as_deref(), Some("/opt/homebrew/bin"));
	}

	#[test]
	fn no_markers_or_empty_value_yields_none() {
		assert_eq!(extract_marked_path("just noise"), None);
		assert_eq!(extract_marked_path(&format!("{m}{m}", m = MARKER)), None);
		assert_eq!(extract_marked_path(&format!("{m}   {m}", m = MARKER)), None);
		// A truncated second marker must not be read as a value.
		assert_eq!(extract_marked_path(&format!("{m}/usr/bin", m = MARKER)), None);
	}

	/// THE case from the bug report: the app's launchd PATH lacks
	/// `/opt/homebrew/bin`, where yarn lives.
	#[test]
	fn merge_adds_shell_dirs_missing_from_the_launchd_path() {
		let launchd = "/usr/bin:/bin:/usr/sbin:/sbin";
		let login = "/opt/homebrew/bin:/Users/x/.nvm/versions/node/v24/bin:/usr/bin:/bin";

		let merged = merge_paths(login, launchd);

		assert_eq!(
			merged,
			"/opt/homebrew/bin:/Users/x/.nvm/versions/node/v24/bin:/usr/bin:/bin:/usr/sbin:/sbin"
		);
	}

	/// Resolution must only ever ADD: whatever we inherited stays reachable, so
	/// this can't break a setup that already worked (e.g. `npm run tauri dev`
	/// from a terminal, which inherits a good PATH).
	#[test]
	fn merge_never_drops_an_inherited_directory() {
		let inherited = "/custom/tool/bin:/usr/bin";

		let merged = merge_paths("/opt/homebrew/bin", inherited);

		for dir in inherited.split(':') {
			assert!(merged.split(':').any(|d| d == dir), "{} must survive", dir);
		}
	}

	#[test]
	fn posix_shells_are_probed_with_a_quoted_variable() {
		for shell in ["/bin/sh", "/bin/bash", "/bin/zsh", "/usr/bin/dash"] {
			let script = probe_script(shell).expect("POSIX shells are probeable");
			assert!(script.contains("\"$PATH\""), "{} script: {}", shell, script);
			assert!(script.contains(MARKER));
		}
	}

	/// In fish `$PATH` is a LIST, so `"$PATH"` would come back space-separated
	/// and produce a nonsense PATH.
	#[test]
	fn fish_is_probed_with_string_join() {
		let script = probe_script("/opt/homebrew/bin/fish").expect("fish is probeable");

		assert!(script.contains("string join : $PATH"), "script: {}", script);
		assert!(!script.contains("\"$PATH\""));
	}

	/// Shells whose syntax we can't write: decline rather than run something
	/// that would return garbage.
	#[test]
	fn non_posix_shells_are_declined() {
		for shell in ["/usr/bin/nu", "/usr/local/bin/elvish", "/usr/bin/pwsh"] {
			assert_eq!(probe_script(shell), None, "{} should be declined", shell);
		}
	}

	#[test]
	fn merge_dedupes_and_drops_empty_segments() {
		// An empty segment means "current directory" — never propagate it.
		assert_eq!(merge_paths("/a::/b", "/b:/a:"), "/a:/b");
	}
}
