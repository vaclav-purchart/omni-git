//! UI settings, on disk next to `repos.json`.
//!
//! These used to live in the webview's `localStorage`, which was wrong in two
//! ways. It is keyed by ORIGIN, so `http://localhost:1420` in dev and the
//! bundled app's `tauri://` origin have separate stores — settings appeared to be
//! wiped by a rebuild. And Rust cannot read it at all: the window is created
//! before the webview exists, so anything the native side needs to know at
//! startup (the theme, for instance) is simply unavailable there.
//!
//! Values are stored as their JSON encoding (`key -> raw string`), deliberately
//! mirroring `localStorage`'s shape so the frontend's accessors keep the same
//! signature and every existing call site is unchanged.

use crate::store::repos::StoreError;
use std::collections::BTreeMap;
use std::path::PathBuf;

pub type Settings = BTreeMap<String, String>;

pub struct SettingsStore {
	path: PathBuf,
}

impl SettingsStore {
	pub fn new(path: PathBuf) -> Self {
		Self { path }
	}

	/// Reads the settings. A missing file is empty settings (first run), but a
	/// file that exists and fails to parse is an ERROR rather than silently empty
	/// — reporting it beats overwriting whatever is in there with defaults.
	pub fn load(&self) -> Result<Settings, StoreError> {
		match std::fs::read_to_string(&self.path) {
			Ok(s) if s.trim().is_empty() => Ok(Settings::new()),
			Ok(s) => serde_json::from_str(&s)
				.map_err(|e| StoreError::Io(format!("settings.json is not valid: {e}"))),
			Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::new()),
			Err(e) => Err(StoreError::Io(e.to_string())),
		}
	}

	/// Writes the settings atomically: to a temp file in the same directory, then
	/// renamed over the target. A plain write can be interrupted (a crash, a
	/// full disk) and leave a truncated file, which the loader above would then
	/// correctly refuse — losing every setting. Rename within one filesystem
	/// either happens or doesn't.
	pub fn save(&self, settings: &Settings) -> Result<(), StoreError> {
		let json = serde_json::to_string_pretty(settings)
			.map_err(|e| StoreError::Io(e.to_string()))?;
		if let Some(dir) = self.path.parent() {
			std::fs::create_dir_all(dir).map_err(|e| StoreError::Io(e.to_string()))?;
		}
		let tmp = self.path.with_extension("json.tmp");
		std::fs::write(&tmp, json).map_err(|e| StoreError::Io(e.to_string()))?;
		std::fs::rename(&tmp, &self.path).map_err(|e| StoreError::Io(e.to_string()))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn store(dir: &std::path::Path) -> SettingsStore {
		SettingsStore::new(dir.join("settings.json"))
	}

	#[test]
	fn missing_file_is_empty_settings() {
		let d = tempfile::tempdir().unwrap();

		assert_eq!(store(d.path()).load().unwrap(), Settings::new());
	}

	#[test]
	fn round_trips() {
		let d = tempfile::tempdir().unwrap();
		let s = store(d.path());
		let mut settings = Settings::new();
		settings.insert("theme".into(), "\"dark\"".into());
		settings.insert("scope".into(), "\"all\"".into());

		s.save(&settings).unwrap();

		assert_eq!(s.load().unwrap(), settings);
	}

	/// The difference that matters: "no file yet" is normal, but a corrupt file
	/// must NOT be reported as empty, or the next save would overwrite the
	/// user's real settings with defaults.
	#[test]
	fn corrupt_file_is_an_error_not_empty() {
		let d = tempfile::tempdir().unwrap();
		std::fs::write(d.path().join("settings.json"), "{not json").unwrap();

		assert!(store(d.path()).load().is_err());
	}

	#[test]
	fn empty_file_is_empty_settings() {
		let d = tempfile::tempdir().unwrap();
		std::fs::write(d.path().join("settings.json"), "  \n").unwrap();

		assert_eq!(store(d.path()).load().unwrap(), Settings::new());
	}

	#[test]
	fn creates_the_directory_if_absent() {
		let d = tempfile::tempdir().unwrap();
		let s = SettingsStore::new(d.path().join("nested").join("settings.json"));
		let mut settings = Settings::new();
		settings.insert("k".into(), "1".into());

		s.save(&settings).unwrap();

		assert_eq!(s.load().unwrap(), settings);
	}

	/// A save must not leave the temp file lying around next to the real one.
	#[test]
	fn save_leaves_no_temp_file() {
		let d = tempfile::tempdir().unwrap();
		let s = store(d.path());

		s.save(&Settings::new()).unwrap();

		let leftovers: Vec<_> = std::fs::read_dir(d.path())
			.unwrap()
			.filter_map(|e| e.ok())
			.map(|e| e.file_name().to_string_lossy().to_string())
			.filter(|n| n.ends_with(".tmp"))
			.collect();
		assert!(leftovers.is_empty(), "temp file left behind: {:?}", leftovers);
	}

	#[test]
	fn overwrites_previous_contents() {
		let d = tempfile::tempdir().unwrap();
		let s = store(d.path());
		let mut first = Settings::new();
		first.insert("a".into(), "1".into());
		s.save(&first).unwrap();

		let mut second = Settings::new();
		second.insert("b".into(), "2".into());
		s.save(&second).unwrap();

		assert_eq!(s.load().unwrap(), second);
	}
}
