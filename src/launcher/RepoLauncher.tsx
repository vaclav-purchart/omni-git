import { FolderPlus, X } from "@phosphor-icons/react"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { useMemo, useRef, useState } from "react"
import type { Repo, StoreError } from "../ipc/bindings"
import { filterRepos } from "../repos/filterRepos"
import { useRepos } from "../repos/useRepos"
import { ThemeToggle } from "../theme/ThemeToggle"
import "./RepoLauncher.css"
import { NO_AUTOCORRECT } from "../ui/textInput"

function describeError(error: StoreError): string {
	switch (error.kind) {
		case "NotAGitRepo":
			return "That folder is not a git repository."
		case "Duplicate":
			return "That repository is already in the list."
		case "NotFound":
			return "Repository not found."
		case "Io":
			return `Could not access that folder: ${error.message}`
	}
}

export function RepoLauncher({ onOpen }: { onOpen: (repo: Repo) => void }) {
	const { repos, add, remove } = useRepos()
	const [query, setQuery] = useState("")
	const [error, setError] = useState<string | null>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	const filtered = useMemo(() => filterRepos(repos, query), [repos, query])

	function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter" && filtered.length > 0) {
			onOpen(filtered[0])
		} else if (e.key === "Escape") {
			e.preventDefault()
			setQuery("")
			inputRef.current?.focus()
		}
	}

	function onQueryChange(value: string) {
		setQuery(value)
		setError(null)
	}

	async function onAdd() {
		const picked = await openDialog({ directory: true, multiple: false })
		if (typeof picked === "string") {
			const result = await add(picked)
			if (result.status === "error") {
				setError(describeError(result.error))
			} else {
				setError(null)
			}
		}
	}

	async function onRemove(id: string) {
		const result = await remove(id)
		if (result.status === "error") {
			setError(describeError(result.error))
		} else {
			setError(null)
		}
	}

	return (
		<div className="launcher">
			<div className="launcher-inner">
				<div className="launcher-topbar">
					<div className="launcher-brand">
						<span className="launcher-brand-mark" />
						<span>omni-git</span>
					</div>
					<ThemeToggle />
				</div>
				<div className="launcher-bar">
					<div className="launcher-search-wrap">
						<svg
							className="launcher-search-icon"
							viewBox="0 0 16 16"
							fill="none"
							aria-hidden="true"
						>
							<circle
								cx="7"
								cy="7"
								r="4.5"
								stroke="currentColor"
								strokeWidth="1.5"
							/>
							<path
								d="M10.5 10.5L14 14"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
						<input
							{...NO_AUTOCORRECT}
							ref={inputRef}
							className="launcher-search"
							placeholder="Search repositories…"
							value={query}
							onChange={(e) => onQueryChange(e.target.value)}
							onKeyDown={onKeyDown}
							autoFocus
						/>
					</div>
					<button
						type="button"
						className="btn btn-primary launcher-add"
						onClick={onAdd}
					>
						<FolderPlus aria-hidden="true" /> Add repository
					</button>
				</div>
				{error && (
					<div className="launcher-error" role="alert">
						<span>{error}</span>
						<button
							type="button"
							className="launcher-error-dismiss"
							aria-label="Dismiss error"
							onClick={() => setError(null)}
						>
							<X aria-hidden="true" />
						</button>
					</div>
				)}
				{repos.length === 0 ? (
					<div className="launcher-empty">
						<svg
							className="launcher-empty-icon"
							viewBox="0 0 24 24"
							fill="none"
							aria-hidden="true"
						>
							<path
								d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinejoin="round"
							/>
						</svg>
						<div className="launcher-empty-title">No repositories yet</div>
						<div>Add a locally checked-out git repository to get started.</div>
						<button
							type="button"
							className="btn btn-primary launcher-empty-add"
							onClick={onAdd}
						>
							<FolderPlus aria-hidden="true" /> Add repository
						</button>
					</div>
				) : filtered.length === 0 ? (
					<div className="launcher-empty">
						<div className="launcher-empty-title">No matches</div>
						<div>No repositories match “{query}”.</div>
					</div>
				) : (
					<ul className="launcher-list">
						{filtered.map((repo) => (
							<li key={repo.id} className="launcher-item">
								<button
									type="button"
									className="launcher-open"
									onClick={() => onOpen(repo)}
								>
									<span className="launcher-name" title={repo.name}>
										{repo.name}
									</span>
									<span className="launcher-path" title={repo.path}>
										{repo.path}
									</span>
								</button>
								<button
									type="button"
									className="launcher-remove"
									title="Remove from list (does not delete on disk)"
									aria-label={`Remove ${repo.name} from list`}
									onClick={() => onRemove(repo.id)}
								>
									<X aria-hidden="true" />
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}
