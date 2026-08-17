import "./theme/theme.css"
import { IconContext } from "@phosphor-icons/react"
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { flushSettings, initSettings } from "./settings/settings"
import { loadPref, resolveTheme } from "./theme/useTheme"

// Settings live on disk and are read synchronously everywhere else, so they must
// be loaded before the first render — the startup path decides which screen to
// show from them.
async function boot() {
	await initSettings()

	// Apply the stored theme before rendering. The window is hidden until the app
	// reveals it, so this happens entirely off-screen and there is nothing to
	// flash. index.html can only guess from the system preference, since it has
	// no IPC.
	const resolved = resolveTheme(
		loadPref(),
		window.matchMedia("(prefers-color-scheme: dark)").matches,
	)
	document.documentElement.setAttribute("data-theme", resolved)

	// A debounced setting changed just before quitting would otherwise be lost.
	window.addEventListener("beforeunload", () => {
		void flushSettings()
	})

	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
		<React.StrictMode>
			{/* App-wide icon defaults: filled glyphs that inherit the button's text
			    color (currentColor) and scale to its font-size (1em). Set once here so
			    individual <Icon/> usages need no weight/color/size props. */}
			<IconContext.Provider
				value={{ weight: "fill", size: "1em", color: "currentColor" }}
			>
				<App />
			</IconContext.Provider>
		</React.StrictMode>,
	)
}

void boot()
