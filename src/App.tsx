import { useEffect, useState } from "react"
import "./App.css"
import { commands, type Repo } from "./ipc/bindings"
import { clearLastRepo, readLastRepo, writeLastRepo } from "./lastRepo"
import { RepoLauncher } from "./launcher/RepoLauncher"
import { Workspace } from "./workspace/Workspace"

export default function App() {
	// Read synchronously, in the state initialiser: the whole point is that the
	// FIRST render already shows the right screen. Doing this in an effect is what
	// made the launcher appear and then get replaced by the restored repo.
	const [stored] = useState(readLastRepo)
	const [selected, setSelected] = useState<Repo | null>(
		stored?.kind === "repo" ? stored.repo : null,
	)
	// Only the legacy id-only format needs a lookup before we know where to go.
	// While that's pending we render NOTHING rather than guessing at the launcher.
	const [resolvingLegacy, setResolvingLegacy] = useState(stored?.kind === "id")
	const [gitOk, setGitOk] = useState(true)

	useEffect(() => {
		commands.gitStatus().then((s) => setGitOk(s.available))
	}, [])

	// Validate against the store, in the background. A repo that has since been
	// removed falls back to the launcher; the common case never waits for this.
	useEffect(() => {
		if (stored === null) {
			return
		}
		let cancelled = false
		commands
			.listRepos()
			.then((r) => {
				if (cancelled || r.status !== "ok") {
					return
				}
				const wantedId = stored.kind === "repo" ? stored.repo.id : stored.id
				const found = r.data.find((x) => x.id === wantedId)
				if (found) {
					// Also picks up a rename/move made elsewhere, and upgrades a legacy
					// id-only entry to the full record.
					setSelected(found)
					writeLastRepo(found)
				} else {
					clearLastRepo()
					setSelected(null)
				}
			})
			// Either way we now know which screen to show, so the window can appear.
			.finally(() => {
				if (!cancelled) {
					setResolvingLegacy(false)
				}
			})
		return () => {
			cancelled = true
		}
	}, [stored])

	// The window starts hidden (tauri.conf.json "visible": false) so launch can't
	// flash the webview's default white before the themed background paints.
	//
	// Reveal as soon as React has committed the DOM. Do NOT wait for an animation
	// frame: macOS suspends rendering for a window that isn't on screen, so
	// requestAnimationFrame never fires while we're hidden — waiting for one meant
	// the app sat invisible until the Rust safety timer gave up and showed it. The
	// committed DOM is painted when the window becomes visible, so there is
	// nothing to wait for anyway.
	useEffect(() => {
		if (resolvingLegacy) {
			return
		}
		void commands.showMainWindow()
	}, [resolvingLegacy])

	function openRepo(repo: Repo) {
		writeLastRepo(repo)
		setSelected(repo)
	}

	function backToLauncher() {
		clearLastRepo()
		setSelected(null)
	}

	return (
		<div className="app">
			{!gitOk && (
				<div className="app-warning">
					<span>⚠</span>
					<span>
						System git was not found. Install git and restart omni-git.
					</span>
				</div>
			)}
			<div className="app-body">
				{resolvingLegacy ? null : selected ? (
					<Workspace
						key={selected.id}
						repo={selected}
						onBack={backToLauncher}
					/>
				) : (
					<RepoLauncher onOpen={openRepo} />
				)}
			</div>
		</div>
	)
}
