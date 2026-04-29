import type { RepoRow, ReleaseRow, SkillRow, SubSkillRow, LibraryRow, CollectionRow, CollectionRepoRow, StarredRepoRow } from './types/repo'
import type { ComponentScanResult } from './types/components'
import type { AiChatMessage } from './components/AiChatOverlay.types'
import type { RecommendationResponse } from './types/recommendation'

declare module '*.png' {
  const src: string
  export default src
}

export {}

/** Filter options for the Discover filter panel */
export interface SearchFilters {
  activity?: 'week' | 'month' | 'halfyear'
  stars?: 100 | 1000 | 10000
  license?: string
}

declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }

  interface SpeechRecognitionEvent extends Event {
    readonly results: SpeechRecognitionResultList
    readonly resultIndex: number
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string
    readonly message: string
  }

  interface GitHubUser {
    login: string
    name: string | null
    avatar_url: string
    bio: string | null
    location: string | null
    company: string | null
    public_repos: number
    followers: number
    following: number
    html_url: string
    blog?: string | null
    created_at?: string | null
  }

  interface Window {
    api: {
      openExternal: (url: string) => Promise<void>

      platform: 'win32' | 'darwin' | 'linux' | string

      windowControls: {
        minimize: () => void
        maximize: () => void
        close:    () => void
      }
      github: {
        startDeviceFlow: () => Promise<{
          deviceCode: string
          userCode: string
          verificationUri: string
          verificationUriComplete: string
          expiresIn: number
          interval: number
        }>
        pollDeviceToken: (deviceCode: string, interval: number) => Promise<void>
        cancelDeviceFlow: () => Promise<void>
        openLoginPopup: (url: string) => Promise<void>
        getUser:       () => Promise<{ login: string; avatarUrl: string; publicRepos: number }>
        getStarred:    (force?: boolean) => Promise<void>
        disconnect:    () => Promise<void>
        searchRepos:   (query: string, sort?: string, order?: string, page?: number) => Promise<RepoRow[]>
        getRepo:       (owner: string, name: string) => Promise<RepoRow | null>
        getReadme:        (owner: string, name: string) => Promise<string | null>
        getFileContent:   (owner: string, name: string, path: string) => Promise<string | null>
        getReleases:   (owner: string, name: string) => Promise<ReleaseRow[]>
        saveRepo:         (owner: string, name: string) => Promise<void>
        getSavedRepos:    () => Promise<{ owner: string; name: string }[]>
        getFeedRepos:     () => Promise<{ owner: string; name: string }[]>
        getMyRepos:       () => Promise<any[]>
        getRelatedRepos:  (owner: string, name: string, topicsJson: string) => Promise<RepoRow[]>
        starRepo:         (owner: string, name: string) => Promise<void>
        unstarRepo:       (owner: string, name: string) => Promise<void>
        isStarred:        (owner: string, name: string) => Promise<boolean>
        getRecommended:   (page?: number, excludeIds?: string[]) => Promise<RecommendationResponse>
        getBranch:        (owner: string, name: string, branch: string) => Promise<{ rootTreeSha: string }>
        getTree:          (owner: string, name: string, treeSha: string) => Promise<Array<{ path: string; mode: string; type: 'blob' | 'tree'; sha: string; size?: number }>>
        getBlob:          (owner: string, name: string, blobSha: string) => Promise<{ content: string; rawBase64: string; size: number }>
        getRawFile:       (owner: string, name: string, branch: string, path: string) => Promise<ArrayBuffer>
        getReceivedEvents: (username: string) => Promise<Array<{
          id: string
          type: 'WatchEvent' | 'ForkEvent' | 'ReleaseEvent' | 'PullRequestEvent'
          actor: { login: string; avatar_url: string }
          repo: { full_name: string }
          payload: Record<string, unknown>
          created_at: string
        }>>
        getCompare: (owner: string, name: string, base: string, head: string) => Promise<{
          base: string
          head: string
          htmlUrl: string
          totalCommits: number
          filesChanged: number
          additions: number
          deletions: number
          topFiles: { filename: string; status: string; additions: number; deletions: number }[]
          topAuthors: { login: string; avatarUrl: string; commits: number }[]
        }>
      }
      settings: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<void>
        getApiKey(): Promise<string | null>
        setApiKey(key: string): Promise<void>
        getPreferredLanguage(): Promise<string>
        setPreferredLanguage(lang: string): Promise<void>
      }
      db: {
        setStarredAt(repoId: string, value: string | null): Promise<void>
        cacheTranslatedDescription(repoId: string, text: string, targetLang: string, detectedLang: string): Promise<void>
        cacheTranslatedReadme(repoId: string, text: string, targetLang: string, detectedLang: string): Promise<void>
      }
      translate: {
        check(text: string, targetLang: string, minLength?: number): Promise<string | null>
        translate(text: string, targetLang: string): Promise<{ translatedText: string; detectedLanguage: string } | null>
      }
      skill: {
        generate(owner: string, name: string, options?: { flavour?: 'library' | 'codebase' | 'domain'; enabledComponents?: string[]; enabledTools?: string[]; target?: 'master' | 'components' | 'all'; ref?: string }): Promise<{ content?: string; system?: string; practice?: string; conflict?: boolean; version: string; generated_at: string; warnings?: string[] }>
        get(owner: string, name: string): Promise<SkillRow | null>
        delete(owner: string, name: string): Promise<void>
        toggle(owner: string, name: string, active: number): Promise<void>
        setEnabledComponents(owner: string, name: string, enabled: string[]): Promise<void>
        setEnabledTools(owner: string, name: string, enabled: string[]): Promise<void>
        detectClaudeCode(): Promise<boolean>
        setup(): Promise<{ success: boolean; error?: string }>
        onSetupProgress(cb: (event: { phase: string; message: string }) => void): void
        offSetupProgress(cb: (event: { phase: string; message: string }) => void): void
        checkAuthStatus(): Promise<boolean>
        loginClaude(): Promise<{ success: boolean; error?: string }>
        logoutClaude(): Promise<void>
        onLoginProgress(cb: (event: { message: string; isError?: boolean; done?: boolean }) => void): void
        offLoginProgress(cb: (event: { message: string; isError?: boolean; done?: boolean }) => void): void
        getSubSkill(owner: string, name: string, skillType: string): Promise<SubSkillRow | null>
        getVersionedInstalls(owner: string, name: string): Promise<string[]>
        getContent(owner: string, name: string): Promise<{ filename: string; content: string } | undefined>
      }
      library: {
        getAll(): Promise<LibraryRow[]>
        getCollections(repoId: string): Promise<{ id: string; name: string }[]>
      }
      collection: {
        getAll(): Promise<CollectionRow[]>
        getDetail(id: string): Promise<CollectionRepoRow[]>
        create(name: string, description: string, repoIds: string[]): Promise<string>
        delete(id: string): Promise<void>
        toggle(id: string, active: number): Promise<void>
      }
      starred: {
        getAll(): Promise<StarredRepoRow[]>
        getRecentlyUnstarred(): Promise<StarredRepoRow[]>
      }
      svgCache: {
        prefetch(owner: string, name: string, branch: string): Promise<void>
        read(owner: string, name: string): Promise<Record<string, string> | null>
      }
      mcp: {
        getStatus(): Promise<{ configured: boolean; configPath: string | null }>
        autoConfigure(): Promise<{ success: boolean; error?: string }>
        getConfigSnippet(): Promise<string>
        testConnection(): Promise<{ running: boolean; skillCount: number }>
        scanTools(owner: string, name: string): Promise<import('./types/mcp').McpScanResult>
      }
      connectors: {
        test(url: string): Promise<{ ok: boolean; statusCode?: number; latencyMs: number; error?: string }>
      }
      search: {
        raw(query: string, language?: string, filters?: SearchFilters, page?: number): Promise<RepoRow[]>
        tagged(tags: string[], originalQuery: string, language?: string, filters?: SearchFilters, page?: number): Promise<RepoRow[]>
        extractTags(query: string): Promise<string[]>
        getRelatedTags(results: RepoRow[], currentTags: string[]): Promise<string[]>
        getTopics(): Promise<string[]>
      }
      org: {
        getVerified: (orgLogin: string) => Promise<boolean>
      }
      repo: {
        extractColor: (avatarUrl: string, repoId: string) => Promise<{ h: number; s: number; l: number }>
        getOgImage: (owner: string, name: string) => Promise<string | null>
      }
      profile: {
        getUser:      (username: string) => Promise<GitHubUser>
        getUserRepos: (username: string, sort?: string) => Promise<any[]>
        getStarred:   (username: string) => Promise<any[]>
        getFollowing: (username: string) => Promise<GitHubUser[]>
        getFollowers: (username: string) => Promise<GitHubUser[]>
        isFollowing:  (username: string) => Promise<boolean>
        follow:       (username: string) => Promise<void>
        unfollow:     (username: string) => Promise<void>
      }
      storybook: {
        detect:   (owner: string, name: string, extraCandidates?: string[]) => Promise<string | null>
        getIndex: (storybookUrl: string) => Promise<unknown>
      }
      components: {
        scan(owner: string, name: string, branch: string): Promise<ComponentScanResult>
        compile(source: string, framework?: string): Promise<string | null>
      }
      verification: {
        prioritise(repoIds: string[]): Promise<void>
        getScore(repoId: string): Promise<{ tier: 'verified' | 'likely' | null; signals: string[]; score: number | null } | null>
        getBatchScores(repoIds: string[]): Promise<Record<string, { tier: string | null; signals: string[] }>>
        onUpdated(cb: (data: { repoId: string; tier: 'verified' | 'likely' | null; signals: string[] }) => void): void
        offUpdated(cb: (data: { repoId: string; tier: 'verified' | 'likely' | null; signals: string[] }) => void): void
      }
      linkPreview: {
        fetch: (url: string) => Promise<import('./utils/linkPreviewFetcher').LinkPreviewResult>
      }
      download: {
        rawFile:   (params: { owner: string; name: string; branch: string; path: string }) => Promise<void>
        rawFolder: (params: { owner: string; name: string; branch: string; path: string }) => Promise<void>
        convert:   (params: { owner: string; name: string; branch: string; path: string; format: 'docx' | 'pdf' | 'epub'; isFolder: boolean }) => Promise<void>
        repoZip:   (owner: string, name: string) => Promise<void>
        pickFolder: () => Promise<string | null>
        getDefaultFolder: () => Promise<string>
        repoConverted: (owner: string, name: string, format: 'pdf' | 'docx' | 'epub') => Promise<void>
        bookmarks: (owner: string, name: string) => Promise<void>
        topLevelFolders: (owner: string, name: string) => Promise<string[]>
      }
      tts: {
        synthesize: (text: string, voiceName: string) => Promise<{ audio: ArrayBuffer; wordBoundaries: { text: string; offsetMs: number }[] }>
        getVoices: () => Promise<{ shortName: string; label: string }[]>
        checkAvailable: () => Promise<boolean>
      }
      ai: {
        getChats: () => Promise<{ id: number; title: string; updated_at: string }[]>
        getChat: (id: number) => Promise<{ id: number; title: string; messages: AiChatMessage[]; created_at: string; updated_at: string } | null>
        saveChat: (chat: { id?: number; title: string; messages: AiChatMessage[] }) => Promise<number>
        deleteChat: (id: number) => Promise<void>
        sendMessage: (payload: { messages: AiChatMessage[]; starredRepos: string[]; installedSkills: string[]; pageContext?: string }) => Promise<{ text: string; html: string }>
        onStreamToken: (cb: (token: string) => void) => void
        offStreamToken: (cb: (token: string) => void) => void
      }
      create: {
        getTemplates: () => Promise<import('./types/create').CreateTemplate[]>
        startSession: (payload: { templateId: string; toolType: string; name: string }) => Promise<import('./types/create').CreateSession>
        getSessions: () => Promise<import('./types/create').CreateSession[]>
        getSession: (id: string) => Promise<import('./types/create').CreateSession | null>
        updateName: (id: string, name: string) => Promise<void>
        updateRepos: (id: string, repoIds: string[]) => Promise<void>
        deleteSession: (id: string) => Promise<void>
        sendMessage: (payload: unknown) => Promise<{ reply: string; changedFiles: string[] }>
        startWebPreview: (sessionId: string, localPath: string) => Promise<{ port: number; url: string }>
        stopPreview: (sessionId: string) => Promise<void>
        spawnMcp: (sessionId: string, entryPoint: string, cwd: string) => Promise<{ ok: boolean }>
        getMcpTools: (sessionId: string) => Promise<unknown[]>
        launchWidget: (sessionId: string, localPath: string) => Promise<void>
        detachWidget: (sessionId: string) => Promise<void>
        relaunchWidget: (sessionId: string, localPath: string) => Promise<void>
        getSuggestions: (templateId: string, repoIds: string[]) => Promise<unknown[]>
        openFolder: (localPath: string) => Promise<void>
        getFileContent: (localPath: string, filePath: string) => Promise<string>
        publishToGitHub: (payload: unknown) => Promise<{ githubRepoUrl: string }>
        pushUpdate: (payload: unknown) => Promise<void>
        onStreamToken: (cb: (data: { sessionId: string; token: string }) => void) => void
        offStreamToken: (cb: (data: { sessionId: string; token: string }) => void) => void
      }
      projects: {
        scanFolder: (folderPath: string) => Promise<Array<{
          name: string
          path: string
          isGit: boolean
          owner: string | null
          repoName: string | null
        }>>
        openFolder: (folderPath: string) => Promise<void>
        readFile: (folderPath: string, filename: string) => Promise<string | null>
        listDir: (folderPath: string, subPath: string) => Promise<Array<{ name: string; path: string; type: 'dir' | 'file'; size: number | null }>>
        renameFolder: (folderPath: string, newName: string) => Promise<string>
        writeFile: (folderPath: string, filename: string, content: string) => Promise<void>
      }
      engagement: {
        logClick: (repoId: string, source: string) => Promise<void>
      }
      updates: {
        checkNow: () => Promise<void>
        lastChecked: () => Promise<{ timestamp: number | null }>
        getChanges: (id: string) => Promise<unknown>
        applyForkSync: (id: string) => Promise<{ ok: boolean; error?: string }>
        applySkillRegen: (id: string) => Promise<{ ok: boolean; error?: string }>
        restartService: () => Promise<void>
        onStatusChanged: (cb: (data: unknown) => void) => void
        offStatusChanged: (cb: (data: unknown) => void) => void
        onToast: (cb: (data: unknown) => void) => void
        offToast: (cb: (data: unknown) => void) => void
      }
      skillSync: {
        setup(): Promise<{ ok: true; repoUrl: string } | { ok: false; error: string }>
        disconnect(): Promise<{ ok: true }>
        retryFailed(): Promise<{ ok: true }>
        getStatus(): Promise<{
          enabled: boolean
          repoOwner: string | undefined
          failedCount: number
          lastSynced: number | null
        }>
        onSyncFailed(cb: (payload: {
          owner?: string
          filename?: string
          summary?: boolean
          failCount?: number
        }) => void): void
        offSyncFailed(cb: (payload: { owner?: string; filename?: string; summary?: boolean; failCount?: number }) => void): void
      }
    }
  }
}
