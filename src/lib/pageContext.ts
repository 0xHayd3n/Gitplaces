/**
 * Maps a route pathname to a rich page-context string for the AI assistant.
 * Used by both AiChatOverlay and AiDialogue so page identification is consistent.
 */
export function getPageContext(pathname: string): string {
  if (pathname === '/' || pathname === '/discover') {
    return 'Discover — the main browsing page where users search for, explore, and discover new GitHub repositories by topic, language, or trending status'
  }
  if (pathname.startsWith('/repo/')) {
    const parts = pathname.split('/')
    const owner = parts[2] || ''
    const name = parts[3] || ''
    return `Repository Detail — viewing the detail page for ${owner}/${name}, showing its README, files, stats, and actions (star, install skill, download)`
  }
  if (pathname === '/library') {
    return 'My Library — the user\'s personal collection of saved/installed repositories and generated skills'
  }
  if (pathname === '/collections') {
    return 'Collections — the user\'s curated groupings of repositories organized by theme or project'
  }
  if (pathname === '/starred') {
    return 'Starred — showing the user\'s GitHub starred repositories synced from their account'
  }
  if (pathname === '/settings') {
    return 'Settings — application configuration including GitHub token, Claude API key, and preferences'
  }
  return 'Gitplaces'
}
