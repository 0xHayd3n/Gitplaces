import type { Repo, SavedRepo, Release, User, LibrarySavedRepo, SkillRow, SubSkillRow, CollectionRow, CollectionRepoRow, AnatomyPayload } from './types/repo'
import type { ComponentScanResult } from './types/components'
import type { AiChatMessage } from './components/AiChatOverlay.types'
import type { RecommendationResponse } from './types/recommendation'
import type { RepoUserEvent } from './types/repoUserEvents'

// NOTE: `declare module '*.png'` lives in src/assets.d.ts, not here. This file
// is a module (top-level imports below), so a wildcard module declaration here
// would be dead under `moduleResolution: "bundler"`.

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

  interface Window {
    api: {
      openExternal: (url: string) => Promise<void>
      showItemInFolder: (fullPath: string) => Promise<void>

      platform: 'win32' | 'darwin' | 'linux' | string

      windowControls: {
        minimize: () => void
        maximize: () => void
        close:    () => void
      }
      repo: {
        extractColor: (avatarUrl: string, repoId: string) => Promise<{ h: number; s: number; l: number }>
        getOgImage: (owner: string, name: string) => Promise<string | null>
        get: (hostId: string, owner: string, name: string) => Promise<SavedRepo | null>
        search: (hostId: string, query: string, sort?: string, order?: string, page?: number) => Promise<Repo[]>
        searchAll: (query: import('../electron/providers/discoverMerge').UnifiedQuery, page?: number) => Promise<SavedRepo[]>
        getReadme: (hostId: string, owner: string, name: string) => Promise<string | null>
        getFileContent: (hostId: string, owner: string, name: string, path: string) => Promise<string | null>
        getReleases: (hostId: string, owner: string, name: string) => Promise<Release[] | null>
        getRepoUserEvents: (hostId: string, owner: string, name: string) => Promise<RepoUserEvent[]>
        getRepoStats: (hostId: string, owner: string, name: string) => Promise<import('./types/repoStats').RepoStats>
        getRepoMomentum: (hostId: string, owner: string, name: string) => Promise<import('./types/repoStats').RepoStats['momentum'] | null>
        fetchBundle: (hostId: string, owner: string, name: string) => Promise<{
          repoRow: SavedRepo | null
          releases: Release[]
          isStarred: boolean
          vulnerabilities: import('../electron/providers/github').RepoBundle['vulnerabilities']
          securityPolicyUrl: string | null
          rootTree: import('../electron/providers/github').RepoBundle['rootTree']
        } | null>
        recordFork: (hostId: string, owner: string, name: string) => Promise<void>
        setArchivedAt: (hostId: string, owner: string, name: string, archived: boolean) => Promise<void>
        save: (hostId: string, owner: string, name: string) => Promise<void>
        getSaved: () => Promise<{ owner: string; name: string }[]>
        getFeed: () => Promise<{ owner: string; name: string }[]>
        getMyRepos: (hostId: string) => Promise<Repo[]>
        getRelated: (hostId: string, owner: string, name: string, topicsJson: string) => Promise<SavedRepo[]>
        star: (hostId: string, owner: string, name: string) => Promise<void>
        unstar: (hostId: string, owner: string, name: string) => Promise<void>
        isStarred: (hostId: string, owner: string, name: string) => Promise<boolean>
        getRecommended: (page?: number, excludeIds?: string[]) => Promise<RecommendationResponse>
        getBranch: (hostId: string, owner: string, name: string, branch: string) => Promise<{ rootTreeSha: string }>
        getTree: (hostId: string, owner: string, name: string, treeSha: string) => Promise<Array<{ path: string; mode: string; type: 'blob' | 'tree'; sha: string; size?: number }>>
        getBlob: (hostId: string, owner: string, name: string, blobSha: string) => Promise<{ content: string; rawBase64: string; size: number }>
        getRawFile: (hostId: string, owner: string, name: string, branch: string, path: string) => Promise<ArrayBuffer>
        getLastCommitsForPaths: (
          hostId: string, repoId: string, owner: string, name: string, ref: string,
          pathShas: { path: string; sha: string }[],
        ) => Promise<Record<string, {
          message: string
          author_login: string | null
          author_avatar: string | null
          committed_at: string
          commit_sha: string
        } | null>>
        compareRefs: (
          hostId: string, repoId: string, owner: string, name: string, base: string, head: string,
        ) => Promise<{ path: string; status: 'added' | 'modified' | 'removed' | 'renamed' }[] | null>
        getCompare: (hostId: string, owner: string, name: string, base: string, head: string) => Promise<{
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
        getMyStarred: (hostId: string, force?: boolean) => Promise<import('./types/repo').StarredEntry[]>
        getReceivedEvents: (hostId: string, username: string) => Promise<Array<{
          id: string
          type: 'WatchEvent' | 'ForkEvent' | 'ReleaseEvent' | 'PullRequestEvent'
          actor: { login: string; avatar_url: string }
          repo: { full_name: string }
          payload: Record<string, unknown>
          created_at: string
        }>>
      }
      hosts: {
        list: () => Promise<import('../electron/providers/types').HostInstance[]>
        get: (hostId: string) => Promise<import('../electron/providers/types').HostInstance | null>
        add: (input: {
          type: import('../electron/providers/types').HostType
          baseUrl: string
          label: string
          webUrl?: string
        }) => Promise<import('../electron/providers/types').HostInstance>
        remove: (hostId: string) => Promise<void>
        setLabel: (hostId: string, label: string) => Promise<import('../electron/providers/types').HostInstance>
        probe: (input: {
          type: import('../electron/providers/types').HostType
          baseUrl: string
        }) => Promise<{ ok: boolean; error?: string }>
        setToken: (hostId: string, token: string) => Promise<{ user: User }>
        clearToken: (hostId: string) => Promise<void>
        getConnectedUser: (hostId: string) => Promise<User | null>
        getCapabilities: (hostId: string) => Promise<import('../electron/providers/types').ProviderCapabilities | null>
        healthCheck: () => Promise<Record<string, { ok: true } | { ok: false; error: string }>>
        onCapabilitiesChanged: (cb: (event: { hostId: string }) => void) => void
        offCapabilitiesChanged: (cb: (event: { hostId: string }) => void) => void
        startDeviceFlow: (hostId: string) => Promise<{
          deviceCode: string
          userCode: string
          verificationUri: string
          verificationUriComplete: string
          expiresIn: number
          interval: number
        }>
        pollDeviceToken: (hostId: string, deviceCode: string, interval: number) => Promise<{ user: User }>
        cancelDeviceFlow: (hostId: string) => Promise<void>
        openLoginPopup: (hostId: string, url: string) => Promise<void>
      }
      settings: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<void>
        getApiKey(): Promise<string | null>
        setApiKey(key: string): Promise<void>
        getPreferredLanguage(): Promise<string>
        setPreferredLanguage(lang: string): Promise<void>
      }
      llm: {
        listProviders(): Promise<string[]>
        getProviderConfig(provider: string): Promise<{ enabled: boolean; apiKey?: string; organization?: string }>
        setProviderConfig(provider: string, cfg: { enabled: boolean; apiKey?: string; organization?: string }): Promise<void>
        listOpenAICompatibleEndpoints(): Promise<Array<{ id: string; label: string; baseUrl: string; apiKey?: string }>>
        upsertOpenAICompatibleEndpoint(ep: { id: string; label: string; baseUrl: string; apiKey?: string }): Promise<void>
        removeOpenAICompatibleEndpoint(id: string): Promise<void>
        getDefault(feature: 'chat' | 'skillGen' | 'tagExtract'): Promise<{ provider: string; model: string; endpoint?: string } | undefined>
        setDefault(feature: 'chat' | 'skillGen' | 'tagExtract', ref: { provider: string; model: string; endpoint?: string }): Promise<void>
        testConnection(ref: { provider: string; model: string; endpoint?: string }): Promise<{ ok: boolean; sample?: string; kind?: string; message?: string }>
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
        generate(owner: string, name: string, options?: { flavour?: 'library' | 'codebase' | 'domain'; enabledComponents?: string[]; enabledTools?: string[]; target?: 'master' | 'components' | 'all'; ref?: string }): Promise<{ content?: string; system?: string; practice?: string; conflict?: boolean; version: string; generated_at: string; warnings?: string[] } | { cancelled: true }>
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
        cancelLearn(owner: string, name: string): Promise<{ cancelled: boolean }>
        onLearnProgress(cb: (event: {
          owner: string; name: string; phase: string; percent: number; elapsedMs: number
          state: 'running' | 'completed' | 'cancelled' | 'failed'; error?: string
        }) => void): void
        offLearnProgress(cb: (event: {
          owner: string; name: string; phase: string; percent: number; elapsedMs: number
          state: 'running' | 'completed' | 'cancelled' | 'failed'; error?: string
        }) => void): void
        getSubSkill(owner: string, name: string, skillType: string): Promise<SubSkillRow | null>
        getVersionedInstalls(owner: string, name: string): Promise<string[]>
        getContent(owner: string, name: string): Promise<{ filename: string; content: string } | undefined>
        getAnatomy(owner: string, name: string): Promise<AnatomyPayload | null>
      }
      opencode: {
        detect(): Promise<boolean>
        checkAuthStatus(): Promise<boolean>
        setup(): Promise<{ ok: boolean; error?: string }>
        loginOpenCode(): Promise<{ ok: boolean; error?: string }>
        logoutOpenCode(): Promise<void>
        onSetupProgress(cb: (event: { phase: string; line?: string }) => void): void
        offSetupProgress(cb: (event: { phase: string; line?: string }) => void): void
        onLoginProgress(cb: (event: { message: string; isError?: boolean; done?: boolean }) => void): void
        offLoginProgress(cb: (event: { message: string; isError?: boolean; done?: boolean }) => void): void
      }
      gemini: {
        detect(): Promise<boolean>
        checkAuthStatus(): Promise<boolean>
        setup(): Promise<{ ok: boolean; error?: string }>
        loginGemini(): Promise<{ ok: boolean; error?: string }>
        logoutGemini(): Promise<void>
        onSetupProgress(cb: (event: { phase: string; line?: string }) => void): void
        offSetupProgress(cb: (event: { phase: string; line?: string }) => void): void
        onLoginProgress(cb: (event: { message: string; isError?: boolean; done?: boolean }) => void): void
        offLoginProgress(cb: (event: { message: string; isError?: boolean; done?: boolean }) => void): void
      }
      codex: {
        detect(): Promise<boolean>
        checkAuthStatus(): Promise<boolean>
        setup(): Promise<{ ok: boolean; error?: string }>
        loginCodex(): Promise<{ ok: boolean; error?: string }>
        logoutCodex(): Promise<void>
        onSetupProgress(cb: (event: { phase: string; line?: string }) => void): void
        offSetupProgress(cb: (event: { phase: string; line?: string }) => void): void
        onLoginProgress(cb: (event: { message: string; isError?: boolean; done?: boolean }) => void): void
        offLoginProgress(cb: (event: { message: string; isError?: boolean; done?: boolean }) => void): void
      }
      library: {
        getAll(): Promise<LibrarySavedRepo[]>
        getCollections(repoId: string): Promise<{ id: string; name: string }[]>
      }
      collection: {
        getAll(): Promise<CollectionRow[]>
        getDetail(id: string): Promise<CollectionRepoRow[]>
        create(name: string, description: string, repoIds: string[]): Promise<string>
        delete(id: string): Promise<void>
        toggle(id: string, active: number): Promise<void>
      }
      agents: {
        getAll(): Promise<{
          folders: import('./types/agent').AgentFolderRow[]
          agents: import('./types/agent').AgentRow[]
        }>
        create(input: {
          name: string
          body: string
          folderId: string | null
          handle: string
          colorStart: string
          colorEnd: string | null
          emoji: string | null
          description?: string
          model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
          tools?: string[] | null
          argumentHint?: string | null
          isSubagent?: boolean
          isSlashCommand?: boolean
          forceOverwrite?: boolean
        }): Promise<import('./types/agent').AgentRow & { syncWarning?: string }>
        update(id: string, patch: {
          name?: string
          body?: string
          folderId?: string | null
          handle?: string
          colorStart?: string
          colorEnd?: string | null
          emoji?: string | null
          pinned?: boolean
          description?: string
          model?: 'sonnet' | 'opus' | 'haiku' | 'inherit'
          tools?: string[] | null
          argumentHint?: string | null
          isSubagent?: boolean
          isSlashCommand?: boolean
          forceOverwrite?: boolean
        }): Promise<import('./types/agent').AgentRow & { syncWarning?: string }>
        delete(id: string): Promise<void>
        duplicate(id: string): Promise<import('./types/agent').AgentRow>
        createFolder(name: string): Promise<import('./types/agent').AgentFolderRow>
        renameFolder(id: string, name: string): Promise<import('./types/agent').AgentFolderRow>
        updateFolder(id: string, patch: {
          name?: string
          colorStart?: string | null
          colorEnd?:   string | null
          emoji?:      string | null
        }): Promise<import('./types/agent').AgentFolderRow>
        deleteFolder(id: string): Promise<void>
        presets: {
          create(agentId: string, name: string, values?: Record<string, string>): Promise<import('./types/agent').AgentPreset>
          update(agentId: string, presetId: string, patch: { name?: string; values?: Record<string, string> }): Promise<import('./types/agent').AgentPreset>
          delete(agentId: string, presetId: string): Promise<void>
          duplicate(agentId: string, presetId: string): Promise<import('./types/agent').AgentPreset>
        }
        revisions: {
          list(agentId: string): Promise<import('./types/agent').AgentRevision[]>
          revert(agentId: string, revisionId: string): Promise<import('./types/agent').AgentRow>
        }
        files: {
          list(agentId: string): Promise<import('./types/agent').AgentFile[]>
          create(agentId: string, input: { filename: string; content: string; sortOrder?: number }): Promise<import('./types/agent').AgentFile>
          update(agentId: string, fileId: string, patch: { filename?: string; content?: string; sortOrder?: number }): Promise<import('./types/agent').AgentFile>
          delete(agentId: string, fileId: string): Promise<void>
        }
        import: {
          discoverPlugins(): Promise<import('../electron/services/pluginImportService').DiscoveredPlugin[]>
          readTargetFromDisk(
            filePath: string,
            kind: 'skill' | 'subagent' | 'slashCommand',
          ): Promise<import('../electron/services/pluginImportService').ParsedImportTarget>
          importTarget(
            target: import('../electron/services/pluginImportService').ParsedImportTarget,
            opts: { folderId: string | null; onConflict: 'overwrite' | 'skip' | 'rename' },
          ): Promise<import('../electron/services/pluginImportService').ImportResult & { syncWarning?: string }>
          discoverPluginInRepo(url: string): Promise<import('../electron/services/pluginImportFromGithubService').RepoPluginIndex>
          readTargetFromRepo(
            owner: string, name: string, branch: string, commitSha: string, repoPath: string,
            kind: 'skill' | 'subagent' | 'slashCommand',
          ): Promise<import('../electron/services/pluginImportService').ParsedImportTarget>
        }
        sync: {
          checkConflict(agentId: string): Promise<{
            subagentExists: boolean
            slashCommandExists: boolean
            subagentPath: string
            slashCommandPath: string
          }>
          retry(agentId: string): Promise<import('../electron/services/agentFileSyncService').SyncResult>
          preview(agentId: string): Promise<{
            subagent: string | null
            slashCommand: string | null
          }>
        }
        recordUse(agentId: string, presetId: string | null): Promise<void>
        primaryContent(agentId: string): Promise<{
          id: string
          filename: string
          content: string
          updated_at: string
        }>
        mcp: {
          getConfigSnippet(): Promise<string>
        }
        onRevisionAdded(cb: (rev: import('./types/agent').AgentRevision) => void): void
        offRevisionAdded(cb: (rev: import('./types/agent').AgentRevision) => void): void
        onChanged(cb: () => void): void
        offChanged(cb: () => void): void
      }
      starred: {
        getAll(): Promise<LibrarySavedRepo[]>
        getRecentlyUnstarred(): Promise<LibrarySavedRepo[]>
      }
      svgCache: {
        prefetch(owner: string, name: string, branch: string): Promise<void>
        read(owner: string, name: string): Promise<Record<string, string> | null>
      }
      mcp: {
        getStatus(target?: 'claude' | 'opencode' | 'gemini' | 'codex'): Promise<{ configured: boolean; configPath: string | null }>
        autoConfigure(target?: 'claude' | 'opencode' | 'gemini' | 'codex'): Promise<{ success: boolean; error?: string }>
        getConfigSnippet(target?: 'claude' | 'opencode' | 'gemini' | 'codex'): Promise<string>
        testConnection(): Promise<{ running: boolean; skillCount: number }>
        scanTools(owner: string, name: string): Promise<import('./types/mcp').McpScanResult>
      }
      connectors: {
        test(url: string): Promise<{ ok: boolean; statusCode?: number; latencyMs: number; error?: string }>
      }
      search: {
        raw(query: string, language?: string, filters?: SearchFilters, page?: number): Promise<Repo[]>
        tagged(tags: string[], originalQuery: string, language?: string, filters?: SearchFilters, page?: number): Promise<Repo[]>
        extractTags(query: string): Promise<string[]>
        getRelatedTags(results: Repo[], currentTags: string[]): Promise<string[]>
        getTopics(): Promise<string[]>
      }
      org: {
        getVerified: (orgLogin: string) => Promise<boolean>
      }
      profile: {
        getUser:      (username: string) => Promise<User>
        getUserRepos: (username: string, sort?: string) => Promise<any[]>
        getStarred:   (username: string) => Promise<any[]>
        getFollowing: (username: string) => Promise<User[]>
        getFollowers: (username: string) => Promise<User[]>
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
        compile(source: string, framework?: string): Promise<
          | { ok: true; code: string }
          | { ok: false; error: string }
        >
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
        sendMessage: (payload: {
          messages: AiChatMessage[]
          starredRepos: string[]
          installedSkills: string[]
          pageContext?: string
          agentId?: string | null
          modelRef?: { provider: string; model: string; endpoint?: string }
        }) => Promise<{ text: string; html: string }>
        onStreamToken: (cb: (token: string) => void) => void
        offStreamToken: (cb: (token: string) => void) => void
        onStreamEvent: (cb: (event: { type: string; [k: string]: unknown }) => void) => void
        offStreamEvent: (cb: (event: { type: string; [k: string]: unknown }) => void) => void
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
        getRecentlyVisited: (limit?: number) => Promise<SavedRepo[]>
      }
      updates: {
        checkNow: () => Promise<void>
        lastChecked: () => Promise<{ timestamp: number | null }>
        getChanges: (id: string) => Promise<unknown>
        applyForkSync: (id: string) => Promise<{ ok: boolean; error?: string }>
        applySkillRegen: (id: string) => Promise<{ ok: boolean; error?: string }>
        restartService: () => Promise<void>
        onStatusChanged: (cb: (data: { ids: string[] }) => void) => void
        offStatusChanged: (cb: (data: { ids: string[] }) => void) => void
        onToast: (cb: (data: { message: string }) => void) => void
        offToast: (cb: (data: { message: string }) => void) => void
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
