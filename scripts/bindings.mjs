// Generates src/ipc/bindings.ts, the typed IPC surface the frontend imports.
//
// The bindings are produced by RUNNING a Rust test that walks the command
// registry, so generating them needs a cargo toolchain AND an executable that
// links the whole tauri stack — including the platform webview. That is more
// than a frontend typecheck should insist on, and it can fail for reasons that
// have nothing to do with the frontend. So `--if-missing` accepts an existing
// file as-is, and a generation failure is only fatal when there is no file to
// fall back on.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const target = path.join(root, "src", "ipc", "bindings.ts")
const rel = path.relative(root, target)
const ifMissing = process.argv.includes("--if-missing")

if (ifMissing && existsSync(target)) {
	console.log(
		`${rel} is present — skipping generation (\`npm run bindings\` refreshes it)`,
	)
	process.exit(0)
}

// The app binary with a flag, not `cargo test`: see src-tauri/src/main.rs for why
// a test harness cannot run this on Windows, and why this isn't a second bin.
const result = spawnSync("cargo", ["run", "--", "--export-bindings"], {
	cwd: path.join(root, "src-tauri"),
	stdio: "inherit",
	// cargo resolves through a shim on Windows.
	shell: process.platform === "win32",
})

if (result.status === 0) {
	process.exit(0)
}

// A stale file beats no file: the frontend cannot typecheck without one, and the
// contents only change when the Rust command surface does.
if (existsSync(target)) {
	console.warn(
		`\n! Could not regenerate ${rel} — continuing with the existing file.`,
	)
	process.exit(0)
}

console.error(
	`\n! Could not generate ${rel}, and there is no existing copy to fall back on.\n` +
		`  The frontend cannot typecheck without it. Either fix the cargo failure above, or\n` +
		`  copy the file from a machine where \`npm run bindings\` works — it is plain\n` +
		`  TypeScript with no platform-specific content.`,
)
process.exit(1)
