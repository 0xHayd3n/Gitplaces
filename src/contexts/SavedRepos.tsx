import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { HOST_ID_GITHUB } from '../lib/hostIds'

interface SavedReposContextValue {
  isSaved: (owner: string, name: string) => boolean
  saveRepo: (owner: string, name: string) => Promise<void>
  loading: boolean
}

const SavedReposContext = createContext<SavedReposContextValue>({
  isSaved: () => false,
  saveRepo: async () => {},
  loading: true,
})

export function SavedReposProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const setRef = useRef(saved)
  setRef.current = saved

  useEffect(() => {
    window.api.repo.getSaved()
      .then((rows) => {
        setSaved(new Set(rows.map((r) => `${r.owner}/${r.name}`)))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const isSaved = (owner: string, name: string) => setRef.current.has(`${owner}/${name}`)

  const saveRepo = async (owner: string, name: string) => {
    const key = `${owner}/${name}`
    setSaved((prev) => new Set([...prev, key]))  // optimistic
    await window.api.repo.save(HOST_ID_GITHUB, owner, name)
  }

  return (
    <SavedReposContext.Provider value={{ isSaved, saveRepo, loading }}>
      {children}
    </SavedReposContext.Provider>
  )
}

export function useSavedRepos() {
  return useContext(SavedReposContext)
}
