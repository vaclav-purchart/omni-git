//! Rescues a window whose restored geometry would put it out of reach.
//!
//! The window-state plugin restores size and position verbatim from the last run,
//! with no check that either still makes sense. That is normally what you want —
//! and occasionally catastrophic: a saved 16×16 window at (-2880, 2816) restores
//! to a 16-pixel dot on a monitor that no longer exists, so the app launches,
//! runs, and appears not to start at all. There is no way out from inside the
//! app, because the thing you would click is what is missing.
//!
//! Two ways that state gets written. A display that was there last time is gone
//! now, which is ordinary laptop life; or the app is quit before the frontend
//! reveals the window (it is created hidden on purpose — see
//! `commands::misc::show_main_window`), and a never-shown window can report a
//! degenerate size for the plugin to save.

/// A window or monitor rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
	pub x: i32,
	pub y: i32,
	pub width: i32,
	pub height: i32,
}

/// The default the window falls back to. Deliberately smaller than the config's
/// first-run size: this runs when something is already wrong, and a modest window
/// is likelier to fit whatever display is actually attached.
pub const FALLBACK: (u32, u32) = (1100, 720);

/// Enough of the window must be on a monitor to grab. A single overlapping pixel
/// is not a window you can move.
pub const MIN_VISIBLE: i32 = 80;

/// Whether a window is big enough to be usable.
pub fn is_usable_size(window: Rect, min_width: i32, min_height: i32) -> bool {
	window.width >= min_width && window.height >= min_height
}

fn overlap(a1: i32, a2: i32, b1: i32, b2: i32) -> i32 {
	a2.min(b2) - a1.max(b1)
}

/// Whether at least `MIN_VISIBLE` pixels of the window fall inside some monitor,
/// in both axes at once — a window overlapping one monitor horizontally and a
/// different one vertically is not reachable on either.
pub fn is_reachable(window: Rect, monitors: &[Rect]) -> bool {
	monitors.iter().any(|m| {
		overlap(window.x, window.x + window.width, m.x, m.x + m.width) >= MIN_VISIBLE
			&& overlap(
				window.y,
				window.y + window.height,
				m.y,
				m.y + m.height,
			) >= MIN_VISIBLE
	})
}

/// Whether the restored geometry can be left alone.
pub fn is_ok(window: Rect, monitors: &[Rect], min_width: i32, min_height: i32) -> bool {
	// No monitors reported is not a reason to move a window: it means the query
	// failed, and guessing from that would be worse than doing nothing.
	if monitors.is_empty() {
		return true;
	}
	is_usable_size(window, min_width, min_height) && is_reachable(window, monitors)
}

/// Moves the window back onto a monitor if its restored geometry left it out of
/// reach, and gives it a usable size if it had none.
///
/// Best effort throughout: every one of these calls can fail, and a failure here
/// must never stop the app from starting — a window in the wrong place beats no
/// app at all.
pub fn rescue_offscreen(window: &tauri::WebviewWindow) {
	let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size())
	else {
		return;
	};
	let Ok(monitors) = window.available_monitors() else {
		return;
	};
	let monitors: Vec<Rect> = monitors
		.iter()
		.map(|m| Rect {
			x: m.position().x,
			y: m.position().y,
			width: m.size().width as i32,
			height: m.size().height as i32,
		})
		.collect();
	let current = Rect {
		x: position.x,
		y: position.y,
		width: size.width as i32,
		height: size.height as i32,
	};
	// The minimums the window config declares; asking the window itself would be
	// better, but Tauri exposes no getter for them.
	if is_ok(current, &monitors, MIN_WIDTH, MIN_HEIGHT) {
		return;
	}
	// Worth saying out loud: the window is about to move for reasons the user did
	// not ask for, and if this ever fires wrongly the message is the only clue.
	eprintln!(
		"omni-git: restored window geometry {}x{} at ({}, {}) is unreachable on the \
		 current displays — resetting to {}x{}, centred",
		current.width, current.height, current.x, current.y, FALLBACK.0, FALLBACK.1
	);
	let _ = window.set_size(tauri::LogicalSize::new(FALLBACK.0, FALLBACK.1));
	let _ = window.center();
}

/// Mirrors `minWidth`/`minHeight` in tauri.conf.json.
pub const MIN_WIDTH: i32 = 640;
pub const MIN_HEIGHT: i32 = 400;

#[cfg(test)]
mod tests {
	use super::*;

	const LAPTOP: Rect = Rect { x: 0, y: 0, width: 2560, height: 1600 };
	const EXTERNAL: Rect = Rect { x: 2560, y: 0, width: 2560, height: 1440 };

	fn win(x: i32, y: i32, width: i32, height: i32) -> Rect {
		Rect { x, y, width, height }
	}

	#[test]
	fn an_ordinary_window_is_left_alone() {
		assert!(is_ok(win(100, 80, 1400, 900), &[LAPTOP], 640, 400));
	}

	/// The state that actually stranded the app: a 16-pixel window parked on a
	/// monitor that is no longer attached.
	#[test]
	fn the_stranded_window_is_rescued() {
		assert!(!is_ok(win(-2880, 2816, 16, 16), &[LAPTOP], 640, 400));
	}

	#[test]
	fn a_degenerate_size_is_rescued_even_when_on_screen() {
		assert!(!is_ok(win(100, 100, 16, 16), &[LAPTOP], 640, 400));
	}

	#[test]
	fn a_window_on_a_second_monitor_is_fine() {
		assert!(is_ok(win(3000, 200, 1200, 800), &[LAPTOP, EXTERNAL], 640, 400));
	}

	/// Unplugging that second monitor is exactly the ordinary case this exists
	/// for.
	#[test]
	fn the_same_window_is_rescued_once_that_monitor_is_gone() {
		assert!(!is_ok(win(3000, 200, 1200, 800), &[LAPTOP], 640, 400));
	}

	/// Hanging off the edge is normal and must not be "fixed" — people park
	/// windows half off-screen all the time.
	#[test]
	fn a_window_hanging_off_an_edge_is_left_alone() {
		assert!(is_reachable(win(2000, 100, 1200, 800), &[LAPTOP]));
		assert!(is_reachable(win(-400, 100, 1200, 800), &[LAPTOP]));
	}

	/// A sliver is not something you can grab.
	#[test]
	fn a_few_visible_pixels_do_not_count() {
		assert!(!is_reachable(win(2560 - 10, 100, 1200, 800), &[LAPTOP]));
		assert!(!is_reachable(win(100, 1600 - 10, 1200, 800), &[LAPTOP]));
	}

	/// Overlapping one monitor horizontally and another vertically leaves the
	/// window on neither.
	#[test]
	fn overlap_must_be_with_the_same_monitor_in_both_axes() {
		let top = Rect { x: 0, y: 0, width: 1000, height: 1000 };
		let right = Rect { x: 2000, y: 2000, width: 1000, height: 1000 };

		assert!(!is_reachable(win(500, 2500, 300, 300), &[top, right]));
	}

	/// A failed monitor query must not become a reason to move the window.
	#[test]
	fn no_monitors_means_leave_it_alone() {
		assert!(is_ok(win(-2880, 2816, 16, 16), &[], 640, 400));
	}
}
