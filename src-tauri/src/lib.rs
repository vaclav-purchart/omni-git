mod commands;
mod console_log;
mod git;
mod store;
mod sys;
mod watcher;
mod window_guard;

use tauri_specta::{collect_commands, collect_events, Builder};

fn specta_builder() -> Builder {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![commands::misc::ping, commands::misc::git_status, commands::misc::show_main_window, commands::misc::open_terminal, commands::settings::load_settings, commands::settings::save_settings, commands::repos::list_repos, commands::repos::add_repo, commands::repos::remove_repo, commands::repo_read::log_commits, commands::repo_read::commit_files, commands::repo_read::file_diff, commands::repo_read::default_branch, commands::repo_read::branch_diff, commands::repo_read::branch_file_diff, commands::repo_read::fork_base, commands::repo_read::working_status, commands::repo_read::working_file_diff, commands::repo_read::recent_console_entries, commands::repo_write::stage_file, commands::repo_write::unstage_file, commands::repo_write::stage_all, commands::repo_write::unstage_all, commands::repo_write::discard_file, commands::repo_write::stage_tracked, commands::repo_write::stage_paths, commands::repo_write::unstage_paths, commands::repo_write::discard_paths, commands::repo_write::clean_paths, commands::repo_write::discard_all_unstaged, commands::repo_write::clean_untracked, commands::repo_write::commit, commands::repo_write::head_commit_message, commands::repo_write::recent_commit_messages, commands::repo_write::commit_message, commands::repo_write::run_git_command, commands::repo_write::fetch, commands::repo_write::pull, commands::repo_write::push, commands::repo_write::branch_op, commands::repo_write::reset, commands::repo_write::reword_commit, commands::repo_write::cherry_pick, commands::repo_refs::list_refs, commands::repo_refs::list_worktrees, commands::repo_refs::list_stashes, commands::repo_read::stash_files, commands::repo_read::stash_file_diff, commands::repo_write::restore_stash, commands::repo_write::stash_push, commands::repo_write::merge, commands::repo_read::repo_operation, commands::repo_write::operation_action, crate::watcher::watch_repo, crate::watcher::unwatch_repo])
        .events(collect_events![crate::git::run::GitConsoleEntry, crate::watcher::RepoChanged, crate::git::stream::CommandChunk, crate::git::stream::CommandDone])
}

/// Where the generated bindings live, resolved from the crate root so it never
/// depends on the working directory the generator happens to be run from.
const BINDINGS_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/ipc/bindings.ts");

/// Writes the TypeScript IPC bindings that the frontend imports.
///
/// Public so the app binary can call it via `--export-bindings` (see `main.rs`)
/// rather than only a test. On Windows the application manifest that `tauri-build`
/// embeds — the one declaring Common Controls v6, without which `comctl32`'s
/// `TaskDialogIndirect` is missing — is applied to bin targets only. A `cargo test`
/// harness therefore could not load at all, dying with STATUS_ENTRYPOINT_NOT_FOUND
/// before `main`.
pub fn export_bindings() {
    specta_builder()
        .export(typescript_config(), BINDINGS_PATH)
        .expect("failed to export typescript bindings");
}

/// The generated bindings include a couple of items (e.g. the events proxy
/// helper) that are unused while there are no events registered yet. Silence
/// TypeScript's `noUnusedLocals`/`noUnusedParameters` for this generated file
/// via a header comment rather than relaxing the project-wide tsconfig.
fn typescript_config() -> specta_typescript::Typescript {
    specta_typescript::Typescript::default()
        .header("// @ts-nocheck\n")
        // `GitConsoleEntry::duration_ms`/`timestamp_ms` are u64/i64; Specta
        // forbids BigInt export by default since it can't assume the
        // serializer supports it. Tauri's IPC (JSON) does, and these values
        // fit safely within a JS `number`, so export them as `number`.
        .bigint(specta_typescript::BigIntExportBehavior::Number)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    #[cfg(debug_assertions)]
    export_bindings();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Restores the window's size, position and maximised/fullscreen state
        // from the previous run, and saves it on exit.
        //
        // VISIBLE is deliberately excluded: the plugin's restore calls `show()`
        // for it, which defeated `"visible": false` and put an empty window on
        // screen before the webview had painted anything — the app appeared,
        // flashed, and only then showed the repo. Visibility is ours to control
        // (see commands::misc::show_main_window).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(console_log::ConsoleLog::default())
        .manage(watcher::RepoWatcher::default())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            // Resolve the login-shell PATH in the background (see git::env).
            git::env::prewarm_git_path();
            // Safety net for the hidden window: if the frontend never calls
            // show_main_window (a crash, a broken build), reveal it anyway rather
            // than leaving a running app with no window.
            //
            // Kept SHORT. This is a fallback, not part of the normal path — and
            // when it did become the normal path (the frontend was waiting on an
            // animation frame that a hidden window never delivers), a long timer
            // turned a fast start into several seconds of nothing.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                commands::misc::show_main_window_now(&handle);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running omni-git");
}

#[cfg(test)]
mod tests {
    /// Same code path as `main.rs`'s `--export-bindings`, so the two cannot drift.
    /// Note this test cannot RUN on Windows — see `export_bindings` — which is why
    /// the build drives the binary instead.
    #[test]
    fn export_bindings() {
        super::export_bindings();
    }
}
