import { useCallback, useEffect, useState } from "react"
import { commands, type Repo } from "../ipc/bindings"

export function useRepos() {
	const [repos, setRepos] = useState<Repo[]>([])
	const [loading, setLoading] = useState(true)

	const reload = useCallback(async () => {
		setLoading(true)
		const result = await commands.listRepos()
		if (result.status === "ok") {
			setRepos(result.data)
		}
		setLoading(false)
	}, [])

	useEffect(() => {
		reload()
	}, [reload])

	const add = useCallback(
		async (path: string) => {
			const result = await commands.addRepo(path)
			await reload()
			return result
		},
		[reload],
	)

	const remove = useCallback(
		async (id: string) => {
			const result = await commands.removeRepo(id)
			await reload()
			return result
		},
		[reload],
	)

	return { repos, loading, add, remove, reload }
}
