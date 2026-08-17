use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Repo {
	pub id: String,
	pub name: String,
	pub path: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "message")]
pub enum StoreError {
	NotAGitRepo,
	Duplicate,
	NotFound,
	Io(String),
}

pub struct RepoStore {
	path: PathBuf,
}

impl RepoStore {
	pub fn new(path: PathBuf) -> Self {
		Self { path }
	}

	pub fn list(&self) -> Vec<Repo> {
		match std::fs::read_to_string(&self.path) {
			Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
			Err(_) => Vec::new(),
		}
	}

	fn write(&self, repos: &[Repo]) -> Result<(), StoreError> {
		let json = serde_json::to_string_pretty(repos).map_err(|e| StoreError::Io(e.to_string()))?;
		if let Some(parent) = self.path.parent() {
			std::fs::create_dir_all(parent).map_err(|e| StoreError::Io(e.to_string()))?;
		}
		std::fs::write(&self.path, json).map_err(|e| StoreError::Io(e.to_string()))
	}

	pub fn add(&self, repo_path: &str) -> Result<Repo, StoreError> {
		let p = Path::new(repo_path);
		if !p.join(".git").exists() {
			return Err(StoreError::NotAGitRepo);
		}
		let canonical = std::fs::canonicalize(p)
			.map_err(|e| StoreError::Io(e.to_string()))?
			.to_string_lossy()
			.to_string();
		let mut repos = self.list();
		if repos.iter().any(|r| r.path == canonical) {
			return Err(StoreError::Duplicate);
		}
		let name = p
			.file_name()
			.map(|n| n.to_string_lossy().to_string())
			.unwrap_or_else(|| canonical.clone());
		let repo = Repo {
			id: uuid::Uuid::new_v4().to_string(),
			name,
			path: canonical,
		};
		repos.push(repo.clone());
		self.write(&repos)?;
		Ok(repo)
	}

	pub fn remove(&self, id: &str) -> Result<(), StoreError> {
		let mut repos = self.list();
		let before = repos.len();
		repos.retain(|r| r.id != id);
		if repos.len() == before {
			return Err(StoreError::NotFound);
		}
		self.write(&repos)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::process::Command;

	fn temp_git_repo() -> tempfile::TempDir {
		let dir = tempfile::tempdir().unwrap();
		Command::new("git")
			.arg("init")
			.arg(dir.path())
			.output()
			.unwrap();
		dir
	}

	fn store_in(dir: &Path) -> RepoStore {
		RepoStore::new(dir.join("repos.json"))
	}

	#[test]
	fn add_lists_and_removes_a_repo() {
		let cfg = tempfile::tempdir().unwrap();
		let store = store_in(cfg.path());
		let repo_dir = temp_git_repo();

		let added = store.add(repo_dir.path().to_str().unwrap()).unwrap();
		assert_eq!(store.list().len(), 1);
		assert!(!added.name.is_empty());

		store.remove(&added.id).unwrap();
		assert_eq!(store.list().len(), 0);
	}

	#[test]
	fn rejects_non_git_dir() {
		let cfg = tempfile::tempdir().unwrap();
		let store = store_in(cfg.path());
		let plain = tempfile::tempdir().unwrap();
		assert!(matches!(
			store.add(plain.path().to_str().unwrap()),
			Err(StoreError::NotAGitRepo)
		));
	}

	#[test]
	fn rejects_duplicate() {
		let cfg = tempfile::tempdir().unwrap();
		let store = store_in(cfg.path());
		let repo_dir = temp_git_repo();
		store.add(repo_dir.path().to_str().unwrap()).unwrap();
		assert!(matches!(
			store.add(repo_dir.path().to_str().unwrap()),
			Err(StoreError::Duplicate)
		));
	}

	#[test]
	fn remove_missing_is_not_found() {
		let cfg = tempfile::tempdir().unwrap();
		let store = store_in(cfg.path());
		assert!(matches!(store.remove("nope"), Err(StoreError::NotFound)));
	}
}
