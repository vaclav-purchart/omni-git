import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [react()],

	// Pre-bundle the Phosphor icon barrel with esbuild in dev. Without this,
	// `import { X } from "@phosphor-icons/react"` makes the dev server serve
	// its ~1,200-icon barrel as thousands of separate module requests, which
	// made the app take tens of seconds to load. Pre-bundling collapses it
	// into one optimized dep. (Production builds already tree-shake it.)
	optimizeDeps: {
		include: ["@phosphor-icons/react"],
	},

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,
	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},
}))
