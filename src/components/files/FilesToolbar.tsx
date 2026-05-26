import { useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import './FilesToolbar.css'

interface Props {
  searchValue: string
  onSearchChange: (v: string) => void
}

export default function FilesToolbar(props: Props) {
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onFocus() { searchInputRef.current?.focus() }
    window.addEventListener('files-toolbar:focus-search', onFocus)
    return () => window.removeEventListener('files-toolbar:focus-search', onFocus)
  }, [])

  return (
    <div className="files-toolbar">
      <div className="files-toolbar__search">
        <Search size={12} className="files-toolbar__search-icon" />
        <input
          ref={searchInputRef}
          className="files-toolbar__search-input"
          type="text"
          placeholder="Search files…"
          value={props.searchValue}
          onChange={e => props.onSearchChange(e.target.value)}
        />
      </div>
    </div>
  )
}
