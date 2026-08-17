use crate::git::run::GitConsoleEntry;
use std::collections::VecDeque;
use std::sync::Mutex;

const CAP: usize = 500;

#[derive(Default)]
pub struct ConsoleLog(pub Mutex<VecDeque<GitConsoleEntry>>);

impl ConsoleLog {
	pub fn push(&self, entry: GitConsoleEntry) {
		let mut buf = self.0.lock().unwrap();
		buf.push_back(entry);
		while buf.len() > CAP {
			buf.pop_front();
		}
	}
	pub fn recent(&self) -> Vec<GitConsoleEntry> {
		self.0.lock().unwrap().iter().cloned().collect()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn entry(id: &str) -> GitConsoleEntry {
		GitConsoleEntry {
			id: id.to_string(),
			command: "git x".into(),
			exit_code: 0,
			duration_ms: 1,
			stderr: String::new(),
			timestamp_ms: 0,
		}
	}

	#[test]
	fn keeps_order_and_caps_at_500() {
		let log = ConsoleLog::default();
		for i in 0..(CAP + 10) {
			log.push(entry(&i.to_string()));
		}
		let recent = log.recent();
		assert_eq!(recent.len(), CAP);
		// oldest 10 dropped; first retained is id "10", last is id "509"
		assert_eq!(recent.first().unwrap().id, "10");
		assert_eq!(recent.last().unwrap().id, (CAP + 9).to_string());
	}
}
