import { Moon, Sun } from "@phosphor-icons/react"
import { useTheme } from "./useTheme"

export function ThemeToggle() {
	const { resolved, setPref } = useTheme()
	return (
		<button
			type="button"
			className="btn btn-icon"
			aria-label="Toggle theme"
			title={`Switch to ${resolved === "dark" ? "light" : "dark"} theme`}
			onClick={() => setPref(resolved === "dark" ? "light" : "dark")}
		>
			{resolved === "dark" ? <Moon /> : <Sun />}
		</button>
	)
}
