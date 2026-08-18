// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `--export-bindings` writes src/ipc/bindings.ts and exits, which is how the
    // npm build generates the typed IPC surface (see scripts/bindings.mjs).
    //
    // A flag on THIS binary rather than a second bin target, for two reasons.
    // Tauri picks the package's binary to bundle and a second one displaces the
    // real app — the .app ended up containing the generator. And on Windows only
    // bin targets receive the Common-Controls v6 manifest that `tauri-build`
    // embeds, without which the loader cannot resolve `TaskDialogIndirect`; a
    // `cargo test` harness therefore cannot run the export at all.
    if std::env::args().any(|arg| arg == "--export-bindings") {
        omni_git_lib::export_bindings();
        println!("wrote src/ipc/bindings.ts");
        return;
    }

    omni_git_lib::run()
}
