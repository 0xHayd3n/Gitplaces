import { contextBridge, ipcRenderer } from 'electron'

// Opaque registry of ipcRenderer listener wrappers (keyed by the caller's cb)
// so off* can removeListener the exact wrapper. Wrapper signatures are
// heterogeneous per channel; `any[]` params keep them bivariantly assignable.
const callbackWrappers = new Map<Function, (...args: any[]) => void>()

contextBridge.exposeInMainWorld('api', {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (fullPath: string) => ipcRenderer.invoke('shell:showItemInFolder', fullPath) as Promise<void>,

  platform: process.platform,

  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
  },

  // Host-id-aware repo namespace (multi-host Phase 3+). Includes the
  // pre-Phase-3 `extractColor` + `getOgImage` methods that previously lived
  // in their own `repo: {...}` namespace.
  repo: {
    extractColor: (avatarUrl: string, repoId: string) =>
      ipcRenderer.invoke('repo:extractColor', avatarUrl, repoId),
    getOgImage: (owner: string, name: string) =>
      ipcRenderer.invoke('repo:getOgImage', owner, name),
    get: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:get', hostId, owner, name) as Promise<import('../src/types/repo').SavedRepo | null>,
    search: (hostId: string, query: string, sort?: string, order?: string, page?: number) =>
      ipcRenderer.invoke('repo:search', hostId, query, sort, order, page) as Promise<import('../src/types/repo').Repo[]>,
    searchAll: (query: import('./providers/discoverMerge').UnifiedQuery) =>
      ipcRenderer.invoke('repo:searchAll', query) as Promise<import('../src/types/repo').SavedRepo[]>,
    getReadme: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:getReadme', hostId, owner, name) as Promise<string | null>,
    getFileContent: (hostId: string, owner: string, name: string, path: string) =>
      ipcRenderer.invoke('repo:getFileContent', hostId, owner, name, path) as Promise<string | null>,
    getReleases: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:getReleases', hostId, owner, name) as Promise<import('../src/types/repo').Release[] | null>,
    getRepoUserEvents: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:getRepoUserEvents', hostId, owner, name) as Promise<import('../src/types/repoUserEvents').RepoUserEvent[]>,
    getRepoStats: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:getRepoStats', hostId, owner, name) as Promise<import('../src/types/repoStats').RepoStats>,
    getRepoMomentum: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:getRepoMomentum', hostId, owner, name) as Promise<import('../src/types/repoStats').RepoStats['momentum'] | null>,
    fetchBundle: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:fetchBundle', hostId, owner, name) as Promise<{
        repoRow: import('../src/types/repo').SavedRepo | null
        releases: import('../src/types/repo').Release[]
        isStarred: boolean
        vulnerabilities: import('./providers/github').RepoBundle['vulnerabilities']
        securityPolicyUrl: string | null
        rootTree: import('./providers/github').RepoBundle['rootTree']
      } | null>,
    recordFork: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:recordFork', hostId, owner, name) as Promise<void>,
    setArchivedAt: (hostId: string, owner: string, name: string, archived: boolean) =>
      ipcRenderer.invoke('repo:setArchivedAt', hostId, owner, name, archived) as Promise<void>,
    save: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:save', hostId, owner, name) as Promise<void>,
    getSaved: () =>
      ipcRenderer.invoke('repo:getSaved') as Promise<{ owner: string; name: string }[]>,
    getFeed: () =>
      ipcRenderer.invoke('repo:getFeed') as Promise<{ owner: string; name: string }[]>,
    getMyRepos: (hostId: string) =>
      ipcRenderer.invoke('repo:getMyRepos', hostId) as Promise<import('../src/types/repo').Repo[]>,
    getRelated: (hostId: string, owner: string, name: string, topicsJson: string) =>
      ipcRenderer.invoke('repo:getRelated', hostId, owner, name, topicsJson) as Promise<import('../src/types/repo').SavedRepo[]>,
    star: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:star', hostId, owner, name) as Promise<void>,
    unstar: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:unstar', hostId, owner, name) as Promise<void>,
    isStarred: (hostId: string, owner: string, name: string) =>
      ipcRenderer.invoke('repo:isStarred', hostId, owner, name) as Promise<boolean>,
    getRecommended: (page?: number, excludeIds?: string[]) =>
      ipcRenderer.invoke('repo:getRecommended', page, excludeIds) as Promise<import('../src/types/recommendation').RecommendationResponse>,
    getBranch: (hostId: string, owner: string, name: string, branch: string) =>
      ipcRenderer.invoke('repo:getBranch', hostId, owner, name, branch) as Promise<{ rootTreeSha: string }>,
    getTree: (hostId: string, owner: string, name: string, treeSha: string) =>
      ipcRenderer.invoke('repo:getTree', hostId, owner, name, treeSha) as Promise<import('./providers/github').TreeEntry[]>,
    getBlob: (hostId: string, owner: string, name: string, blobSha: string) =>
      ipcRenderer.invoke('repo:getBlob', hostId, owner, name, blobSha) as Promise<import('./providers/github').BlobResult>,
    getRawFile: (hostId: string, owner: string, name: string, branch: string, path: string) =>
      ipcRenderer.invoke('repo:getRawFile', hostId, owner, name, branch, path) as Promise<ArrayBuffer>,
    getLastCommitsForPaths: (
      hostId: string, repoId: string, owner: string, name: string, ref: string,
      pathShas: { path: string; sha: string }[],
    ) =>
      ipcRenderer.invoke('repo:getLastCommitsForPaths', hostId, repoId, owner, name, ref, pathShas) as Promise<Record<string, {
        message: string
        author_login: string | null
        author_avatar: string | null
        committed_at: string
        commit_sha: string
      } | null>>,
    compareRefs: (
      hostId: string, repoId: string, owner: string, name: string, base: string, head: string,
    ) =>
      ipcRenderer.invoke('repo:compareRefs', hostId, repoId, owner, name, base, head) as Promise<{ path: string; status: 'added' | 'modified' | 'removed' | 'renamed' }[] | null>,
    getCompare: (hostId: string, owner: string, name: string, base: string, head: string) =>
      ipcRenderer.invoke('repo:getCompare', hostId, owner, name, base, head) as Promise<import('./providers/github').CompareSummary>,
    getMyStarred: (hostId: string, force?: boolean) =>
      ipcRenderer.invoke('repo:getMyStarred', hostId, force) as Promise<import('../src/types/repo').StarredEntry[]>,
    getReceivedEvents: (hostId: string, username: string) =>
      ipcRenderer.invoke('repo:getReceivedEvents', hostId, username) as Promise<import('./providers/github').GitHubEvent[]>,
  },

  hosts: {
    list: () =>
      ipcRenderer.invoke('hosts:list') as Promise<import('./providers/types').HostInstance[]>,
    get: (hostId: string) =>
      ipcRenderer.invoke('hosts:get', hostId) as Promise<import('./providers/types').HostInstance | null>,
    add: (input: { type: import('./providers/types').HostType; baseUrl: string; label: string; webUrl?: string }) =>
      ipcRenderer.invoke('hosts:add', input) as Promise<import('./providers/types').HostInstance>,
    remove: (hostId: string) =>
      ipcRenderer.invoke('hosts:remove', hostId) as Promise<void>,
    probe: (input: { type: import('./providers/types').HostType; baseUrl: string }) =>
      ipcRenderer.invoke('hosts:probe', input) as Promise<{ ok: boolean; error?: string }>,
    setToken: (hostId: string, token: string) =>
      ipcRenderer.invoke('hosts:setToken', hostId, token) as Promise<{ user: import('../src/types/repo').User }>,
    clearToken: (hostId: string) =>
      ipcRenderer.invoke('hosts:clearToken', hostId) as Promise<void>,
    getConnectedUser: (hostId: string) =>
      ipcRenderer.invoke('hosts:getConnectedUser', hostId) as Promise<import('../src/types/repo').User | null>,
    getCapabilities: (hostId: string) =>
      ipcRenderer.invoke('hosts:getCapabilities', hostId) as Promise<import('./providers/types').ProviderCapabilities | null>,
    healthCheck: () =>
      ipcRenderer.invoke('hosts:healthCheck') as Promise<Record<string, { ok: true } | { ok: false; error: string }>>,
    onCapabilitiesChanged: (cb: (event: { hostId: string }) => void) => {
      const wrapper = (_: unknown, data: { hostId: string }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('hosts:capabilities-changed', wrapper)
    },
    offCapabilitiesChanged: (cb: (event: { hostId: string }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('hosts:capabilities-changed', wrapper)
        callbackWrappers.delete(cb)
      }
    },
    startDeviceFlow: (hostId: string) =>
      ipcRenderer.invoke('hosts:startDeviceFlow', hostId) as Promise<{
        deviceCode: string
        userCode: string
        verificationUri: string
        verificationUriComplete: string
        expiresIn: number
        interval: number
      }>,
    pollDeviceToken: (hostId: string, deviceCode: string, interval: number) =>
      ipcRenderer.invoke('hosts:pollDeviceToken', hostId, deviceCode, interval) as Promise<{ user: import('../src/types/repo').User }>,
    cancelDeviceFlow: (hostId: string) =>
      ipcRenderer.invoke('hosts:cancelDeviceFlow', hostId) as Promise<void>,
    openLoginPopup: (hostId: string, url: string) =>
      ipcRenderer.invoke('hosts:openLoginPopup', hostId, url) as Promise<void>,
  },

  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),
    setApiKey: (key: string) => ipcRenderer.invoke('settings:setApiKey', key),
    getPreferredLanguage: () => ipcRenderer.invoke('settings:getPreferredLanguage'),
    setPreferredLanguage: (lang: string) => ipcRenderer.invoke('settings:setPreferredLanguage', lang),
  },

  llm: {
    listProviders:                 () => ipcRenderer.invoke('llm:listProviders') as Promise<string[]>,
    getProviderConfig:             (provider: string) => ipcRenderer.invoke('llm:getProviderConfig', provider) as Promise<{ enabled: boolean; apiKey?: string; organization?: string }>,
    setProviderConfig:             (provider: string, cfg: { enabled: boolean; apiKey?: string; organization?: string }) => ipcRenderer.invoke('llm:setProviderConfig', provider, cfg) as Promise<void>,
    listOpenAICompatibleEndpoints: () => ipcRenderer.invoke('llm:listOpenAICompatibleEndpoints') as Promise<Array<{ id: string; label: string; baseUrl: string; apiKey?: string }>>,
    upsertOpenAICompatibleEndpoint: (ep: { id: string; label: string; baseUrl: string; apiKey?: string }) => ipcRenderer.invoke('llm:upsertOpenAICompatibleEndpoint', ep) as Promise<void>,
    removeOpenAICompatibleEndpoint: (id: string) => ipcRenderer.invoke('llm:removeOpenAICompatibleEndpoint', id) as Promise<void>,
    getDefault:                    (feature: 'chat' | 'skillGen' | 'tagExtract') => ipcRenderer.invoke('llm:getDefault', feature) as Promise<{ provider: string; model: string; endpoint?: string } | undefined>,
    setDefault:                    (feature: 'chat' | 'skillGen' | 'tagExtract', ref: { provider: string; model: string; endpoint?: string }) => ipcRenderer.invoke('llm:setDefault', feature, ref) as Promise<void>,
    testConnection:                (ref: { provider: string; model: string; endpoint?: string }) => ipcRenderer.invoke('llm:testConnection', ref) as Promise<{ ok: boolean; sample?: string; kind?: string; message?: string }>,
  },

  skill: {
    generate: (owner: string, name: string, options?: { flavour?: 'library' | 'codebase' | 'domain', enabledComponents?: string[], enabledTools?: string[], target?: 'master' | 'components' | 'all', ref?: string }) =>
      ipcRenderer.invoke('skill:generate', owner, name, options),
    get: (owner: string, name: string) => ipcRenderer.invoke('skill:get', owner, name),
    delete: (owner: string, name: string) => ipcRenderer.invoke('skill:delete', owner, name),
    toggle: (owner: string, name: string, active: number) =>
      ipcRenderer.invoke('skill:toggle', owner, name, active),
    setEnabledComponents: (owner: string, name: string, enabled: string[]) =>
      ipcRenderer.invoke('skill:setEnabledComponents', owner, name, enabled),
    setEnabledTools: (owner: string, name: string, enabled: string[]) =>
      ipcRenderer.invoke('skill:setEnabledTools', owner, name, enabled),
    detectClaudeCode: () => ipcRenderer.invoke('skill:detectClaudeCode'),
    setup: () => ipcRenderer.invoke('skill:setup'),
    onSetupProgress: (cb: (event: { phase: string; message: string }) => void) => {
      const wrapper = (_: unknown, data: { phase: string; message: string }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('skill:setup-progress', wrapper)
    },
    offSetupProgress: (cb: (event: { phase: string; message: string }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('skill:setup-progress', wrapper)
        callbackWrappers.delete(cb)
      }
    },
    checkAuthStatus: () => ipcRenderer.invoke('skill:checkAuthStatus'),
    loginClaude: () => ipcRenderer.invoke('skill:loginClaude'),
    logoutClaude: () => ipcRenderer.invoke('skill:logoutClaude'),
    onLoginProgress: (cb: (event: { message: string; isError?: boolean; done?: boolean }) => void) => {
      const wrapper = (_: unknown, data: { message: string; isError?: boolean; done?: boolean }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('skill:login-progress', wrapper)
    },
    offLoginProgress: (cb: (event: { message: string; isError?: boolean; done?: boolean }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('skill:login-progress', wrapper)
        callbackWrappers.delete(cb)
      }
    },
    cancelLearn: (owner: string, name: string) =>
      ipcRenderer.invoke('skill:cancelLearn', owner, name) as Promise<{ cancelled: boolean }>,
    onLearnProgress: (cb: (event: {
      owner: string; name: string; phase: string; percent: number; elapsedMs: number;
      state: 'running' | 'completed' | 'cancelled' | 'failed'; error?: string
    }) => void) => {
      const wrapper = (_: unknown, data: Parameters<typeof cb>[0]) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('skill:learn-progress', wrapper)
    },
    offLearnProgress: (cb: (event: {
      owner: string; name: string; phase: string; percent: number; elapsedMs: number;
      state: 'running' | 'completed' | 'cancelled' | 'failed'; error?: string
    }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('skill:learn-progress', wrapper)
        callbackWrappers.delete(cb)
      }
    },
    getSubSkill: (owner: string, name: string, skillType: string) =>
      ipcRenderer.invoke('skill:getSubSkill', owner, name, skillType),
    getVersionedInstalls: (owner: string, name: string): Promise<string[]> =>
      ipcRenderer.invoke('skill:get-versioned-installs', owner, name),
    getContent: (owner: string, name: string) =>
      ipcRenderer.invoke('skill:getContent', owner, name),
    getAnatomy: (owner: string, name: string) =>
      ipcRenderer.invoke('skill:getAnatomy', owner, name),
  },

  opencode: {
    detect: () => ipcRenderer.invoke('opencode:detect') as Promise<boolean>,
    checkAuthStatus: () => ipcRenderer.invoke('opencode:checkAuthStatus') as Promise<boolean>,
    setup: () => ipcRenderer.invoke('opencode:setup') as Promise<{ ok: boolean; error?: string }>,
    loginOpenCode: () => ipcRenderer.invoke('opencode:loginOpenCode') as Promise<{ ok: boolean; error?: string }>,
    logoutOpenCode: () => ipcRenderer.invoke('opencode:logoutOpenCode') as Promise<void>,
    onSetupProgress: (cb: (event: { phase: string; line?: string }) => void) => {
      const wrapper = (_: unknown, data: { phase: string; line?: string }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('opencode:setup-progress', wrapper)
    },
    offSetupProgress: (cb: (event: { phase: string; line?: string }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('opencode:setup-progress', wrapper)
        callbackWrappers.delete(cb)
      }
    },
    onLoginProgress: (cb: (event: { message: string; isError?: boolean; done?: boolean }) => void) => {
      const wrapper = (_: unknown, data: { message: string; isError?: boolean; done?: boolean }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('opencode:login-progress', wrapper)
    },
    offLoginProgress: (cb: (event: { message: string; isError?: boolean; done?: boolean }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('opencode:login-progress', wrapper)
        callbackWrappers.delete(cb)
      }
    },
  },

  gemini: {
    detect: () => ipcRenderer.invoke('gemini:detect') as Promise<boolean>,
    checkAuthStatus: () => ipcRenderer.invoke('gemini:checkAuthStatus') as Promise<boolean>,
    setup: () => ipcRenderer.invoke('gemini:setup') as Promise<{ ok: boolean; error?: string }>,
    loginGemini: () => ipcRenderer.invoke('gemini:loginGemini') as Promise<{ ok: boolean; error?: string }>,
    logoutGemini: () => ipcRenderer.invoke('gemini:logoutGemini') as Promise<void>,
    onSetupProgress: (cb: (event: { phase: string; line?: string }) => void) => {
      const wrapper = (_: unknown, data: { phase: string; line?: string }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('gemini:setup-progress', wrapper)
    },
    offSetupProgress: (cb: (event: { phase: string; line?: string }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('gemini:setup-progress', wrapper)
        callbackWrappers.delete(cb)
      }
    },
    onLoginProgress: (cb: (event: { message: string; isError?: boolean; done?: boolean }) => void) => {
      const wrapper = (_: unknown, data: { message: string; isError?: boolean; done?: boolean }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('gemini:login-progress', wrapper)
    },
    offLoginProgress: (cb: (event: { message: string; isError?: boolean; done?: boolean }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('gemini:login-progress', wrapper)
        callbackWrappers.delete(cb)
      }
    },
  },

  codex: {
    detect: () => ipcRenderer.invoke('codex:detect') as Promise<boolean>,
    checkAuthStatus: () => ipcRenderer.invoke('codex:checkAuthStatus') as Promise<boolean>,
    setup: () => ipcRenderer.invoke('codex:setup') as Promise<{ ok: boolean; error?: string }>,
    loginCodex: () => ipcRenderer.invoke('codex:loginCodex') as Promise<{ ok: boolean; error?: string }>,
    logoutCodex: () => ipcRenderer.invoke('codex:logoutCodex') as Promise<void>,
    onSetupProgress: (cb: (event: { phase: string; line?: string }) => void) => {
      const wrapper = (_: unknown, data: { phase: string; line?: string }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('codex:setup-progress', wrapper)
    },
    offSetupProgress: (cb: (event: { phase: string; line?: string }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('codex:setup-progress', wrapper)
        callbackWrappers.delete(cb)
      }
    },
    onLoginProgress: (cb: (event: { message: string; isError?: boolean; done?: boolean }) => void) => {
      const wrapper = (_: unknown, data: { message: string; isError?: boolean; done?: boolean }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('codex:login-progress', wrapper)
    },
    offLoginProgress: (cb: (event: { message: string; isError?: boolean; done?: boolean }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('codex:login-progress', wrapper)
        callbackWrappers.delete(cb)
      }
    },
  },

  library: {
    getAll: () => ipcRenderer.invoke('library:getAll'),
    getCollections: (repoId: string) => ipcRenderer.invoke('library:getCollections', repoId),
  },

  collection: {
    getAll:    () => ipcRenderer.invoke('collection:getAll'),
    getDetail: (id: string) => ipcRenderer.invoke('collection:getDetail', id),
    create:    (name: string, description: string, repoIds: string[]) =>
      ipcRenderer.invoke('collection:create', name, description, repoIds),
    delete:    (id: string) => ipcRenderer.invoke('collection:delete', id),
    toggle:    (id: string, active: number) => ipcRenderer.invoke('collection:toggle', id, active),
  },

  agents: {
    getAll: () =>
      ipcRenderer.invoke('agents:getAll') as Promise<{
        folders: import('../src/types/agent').AgentFolderRow[]
        agents:  import('../src/types/agent').AgentRow[]
      }>,
    create: (input: {
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
    }) =>
      ipcRenderer.invoke('agents:create', input) as Promise<import('../src/types/agent').AgentRow & { syncWarning?: string }>,
    update: (id: string, patch: {
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
    }) =>
      ipcRenderer.invoke('agents:update', id, patch) as Promise<import('../src/types/agent').AgentRow & { syncWarning?: string }>,
    delete: (id: string) => ipcRenderer.invoke('agents:delete', id) as Promise<void>,
    duplicate: (id: string) =>
      ipcRenderer.invoke('agents:duplicate', id) as Promise<import('../src/types/agent').AgentRow>,

    createFolder: (name: string) =>
      ipcRenderer.invoke('agents:createFolder', name) as Promise<import('../src/types/agent').AgentFolderRow>,
    renameFolder: (id: string, name: string) =>
      ipcRenderer.invoke('agents:renameFolder', id, name) as Promise<import('../src/types/agent').AgentFolderRow>,
    updateFolder: (id: string, patch: {
      name?: string
      colorStart?: string | null
      colorEnd?:   string | null
      emoji?:      string | null
    }) =>
      ipcRenderer.invoke('agents:updateFolder', id, patch) as Promise<import('../src/types/agent').AgentFolderRow>,
    deleteFolder: (id: string) => ipcRenderer.invoke('agents:deleteFolder', id) as Promise<void>,

    presets: {
      create: (agentId: string, name: string, values?: Record<string, string>) =>
        ipcRenderer.invoke('agents:presets:create', agentId, name, values) as Promise<import('../src/types/agent').AgentPreset>,
      update: (agentId: string, presetId: string, patch: { name?: string; values?: Record<string, string> }) =>
        ipcRenderer.invoke('agents:presets:update', agentId, presetId, patch) as Promise<import('../src/types/agent').AgentPreset>,
      delete: (agentId: string, presetId: string) =>
        ipcRenderer.invoke('agents:presets:delete', agentId, presetId) as Promise<void>,
      duplicate: (agentId: string, presetId: string) =>
        ipcRenderer.invoke('agents:presets:duplicate', agentId, presetId) as Promise<import('../src/types/agent').AgentPreset>,
    },

    revisions: {
      list: (agentId: string) =>
        ipcRenderer.invoke('agents:revisions:list', agentId) as Promise<import('../src/types/agent').AgentRevision[]>,
      revert: (agentId: string, revisionId: string) =>
        ipcRenderer.invoke('agents:revisions:revert', agentId, revisionId) as Promise<import('../src/types/agent').AgentRow>,
    },

    files: {
      list: (agentId: string) =>
        ipcRenderer.invoke('agents:files:list', agentId) as Promise<import('../src/types/agent').AgentFile[]>,
      create: (agentId: string, input: { filename: string; content: string; sortOrder?: number }) =>
        ipcRenderer.invoke('agents:files:create', agentId, input) as Promise<import('../src/types/agent').AgentFile>,
      update: (agentId: string, fileId: string, patch: { filename?: string; content?: string; sortOrder?: number }) =>
        ipcRenderer.invoke('agents:files:update', agentId, fileId, patch) as Promise<import('../src/types/agent').AgentFile>,
      delete: (agentId: string, fileId: string) =>
        ipcRenderer.invoke('agents:files:delete', agentId, fileId) as Promise<void>,
    },

    import: {
      discoverPlugins: () =>
        ipcRenderer.invoke('agents:import:discoverPlugins') as Promise<import('../electron/services/pluginImportService').DiscoveredPlugin[]>,

      readTargetFromDisk: (
        filePath: string,
        kind: 'skill' | 'subagent' | 'slashCommand',
      ) =>
        ipcRenderer.invoke('agents:import:readTargetFromDisk', filePath, kind) as Promise<import('../electron/services/pluginImportService').ParsedImportTarget>,

      importTarget: (
        target: import('../electron/services/pluginImportService').ParsedImportTarget,
        opts: { folderId: string | null; onConflict: 'overwrite' | 'skip' | 'rename' },
      ) =>
        ipcRenderer.invoke('agents:import:importTarget', target, opts) as Promise<
          import('../electron/services/pluginImportService').ImportResult & { syncWarning?: string }
        >,

      discoverPluginInRepo: (url: string) =>
        ipcRenderer.invoke('agents:import:discoverPluginInRepo', url) as Promise<import('../electron/services/pluginImportFromGithubService').RepoPluginIndex>,

      readTargetFromRepo: (
        owner: string,
        name: string,
        branch: string,
        commitSha: string,
        repoPath: string,
        kind: 'skill' | 'subagent' | 'slashCommand',
      ) =>
        ipcRenderer.invoke('agents:import:readTargetFromRepo', owner, name, branch, commitSha, repoPath, kind) as Promise<import('../electron/services/pluginImportService').ParsedImportTarget>,
    },

    sync: {
      checkConflict: (agentId: string) =>
        ipcRenderer.invoke('agents:sync:checkConflict', agentId) as Promise<{
          subagentExists: boolean
          slashCommandExists: boolean
          subagentPath: string
          slashCommandPath: string
        }>,
      retry: (agentId: string) =>
        ipcRenderer.invoke('agents:sync:retry', agentId) as Promise<import('../electron/services/agentFileSyncService').SyncResult>,
      preview: (agentId: string) =>
        ipcRenderer.invoke('agents:sync:preview', agentId) as Promise<{
          subagent: string | null
          slashCommand: string | null
        }>,
    },

    recordUse: (agentId: string, presetId: string | null) =>
      ipcRenderer.invoke('agents:recordUse', agentId, presetId) as Promise<void>,

    primaryContent: (agentId: string) =>
      ipcRenderer.invoke('agents:primaryContent', agentId) as Promise<{
        id: string
        filename: string
        content: string
        updated_at: string
      }>,

    mcp: {
      getConfigSnippet: () => ipcRenderer.invoke('agents:mcp:getConfigSnippet') as Promise<string>,
    },

    onRevisionAdded: (cb: (rev: import('../src/types/agent').AgentRevision) => void) => {
      const wrapper = (_: unknown, rev: import('../src/types/agent').AgentRevision) => cb(rev)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('agents:revision-added', wrapper)
    },
    offRevisionAdded: (cb: (rev: import('../src/types/agent').AgentRevision) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('agents:revision-added', wrapper)
        callbackWrappers.delete(cb)
      }
    },

    onChanged: (cb: () => void) => {
      const wrapper = () => cb()
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('agents:changed', wrapper)
    },
    offChanged: (cb: () => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('agents:changed', wrapper)
        callbackWrappers.delete(cb)
      }
    },
  },

  starred: {
    getAll:                () => ipcRenderer.invoke('starred:getAll'),
    getRecentlyUnstarred:  () => ipcRenderer.invoke('starred:getRecentlyUnstarred'),
  },

  svgCache: {
    prefetch: (owner: string, name: string, branch: string) =>
      ipcRenderer.invoke('svg-cache:prefetch', owner, name, branch),
    read: (owner: string, name: string) =>
      ipcRenderer.invoke('svg-cache:read', owner, name),
  },

  mcp: {
    getStatus:        (target: 'claude' | 'opencode' | 'gemini' | 'codex' = 'claude') =>
      ipcRenderer.invoke('mcp:getStatus', target) as Promise<{ configured: boolean; configPath: string | null }>,
    autoConfigure:    (target: 'claude' | 'opencode' | 'gemini' | 'codex' = 'claude') =>
      ipcRenderer.invoke('mcp:autoConfigure', target) as Promise<{ success: boolean; error?: string }>,
    getConfigSnippet: (target: 'claude' | 'opencode' | 'gemini' | 'codex' = 'claude') =>
      ipcRenderer.invoke('mcp:getConfigSnippet', target) as Promise<string>,
    testConnection:   () => ipcRenderer.invoke('mcp:testConnection'),
    scanTools:        (owner: string, name: string) =>
      ipcRenderer.invoke('mcp:scanTools', owner, name),
  },

  connectors: {
    test: (url: string) =>
      ipcRenderer.invoke('connectors:test', url) as Promise<{ ok: boolean; statusCode?: number; latencyMs: number; error?: string }>,
  },

  search: {
    raw:            (query: string, language?: string, filters?: import('./smart-search').SearchFilters, page?: number) =>
      ipcRenderer.invoke('search:raw', query, language, filters, page),
    tagged:         (tags: string[], originalQuery: string, language?: string, filters?: import('./smart-search').SearchFilters, page?: number) =>
      ipcRenderer.invoke('search:tagged', tags, originalQuery, language, filters, page),
    extractTags:    (query: string) =>
      ipcRenderer.invoke('search:extractTags', query),
    getRelatedTags: (results: any[], currentTags: string[]) =>
      ipcRenderer.invoke('search:getRelatedTags', results, currentTags),
    getTopics:      () =>
      ipcRenderer.invoke('search:getTopics'),
  },

  org: {
    getVerified: (orgLogin: string) => ipcRenderer.invoke('org:getVerified', orgLogin),
  },

  db: {
    setStarredAt: (repoId: string, value: string | null) =>
      ipcRenderer.invoke('db:setStarredAt', repoId, value),
    cacheTranslatedDescription: (repoId: string, text: string, targetLang: string, detectedLang: string) =>
      ipcRenderer.invoke('db:cacheTranslatedDescription', repoId, text, targetLang, detectedLang),
    cacheTranslatedReadme: (repoId: string, text: string, targetLang: string, detectedLang: string) =>
      ipcRenderer.invoke('db:cacheTranslatedReadme', repoId, text, targetLang, detectedLang),
  },

  translate: {
    check: (text: string, targetLang: string, minLength?: number) =>
      ipcRenderer.invoke('translate:check', text, targetLang, minLength),
    translate: (text: string, targetLang: string) =>
      ipcRenderer.invoke('translate:translate', text, targetLang),
  },

  profile: {
    getUser:      (username: string) => ipcRenderer.invoke('profile:getUser', username),
    getUserRepos: (username: string, sort?: string) => ipcRenderer.invoke('profile:getUserRepos', username, sort),
    getStarred:   (username: string) => ipcRenderer.invoke('profile:getStarred', username),
    getFollowing: (username: string) => ipcRenderer.invoke('profile:getFollowing', username),
    getFollowers: (username: string) => ipcRenderer.invoke('profile:getFollowers', username),
    isFollowing:  (username: string) => ipcRenderer.invoke('profile:isFollowing', username),
    follow:       (username: string) => ipcRenderer.invoke('profile:follow', username),
    unfollow:     (username: string) => ipcRenderer.invoke('profile:unfollow', username),
  },

  storybook: {
    detect:   (owner: string, name: string, extraCandidates?: string[]) =>
      ipcRenderer.invoke('storybook:detect', owner, name, extraCandidates),
    getIndex: (storybookUrl: string) =>
      ipcRenderer.invoke('storybook:getIndex', storybookUrl),
  },

  components: {
    scan: (owner: string, name: string, branch: string) =>
      ipcRenderer.invoke('components:scan', owner, name, branch),
    compile: (source: string, framework?: string) =>
      ipcRenderer.invoke('components:compile', source, framework),
  },

  verification: {
    prioritise: (repoIds: string[]) =>
      ipcRenderer.invoke('verification:prioritise', repoIds),
    getScore: (repoId: string) =>
      ipcRenderer.invoke('verification:getScore', repoId),
    getBatchScores: (repoIds: string[]) =>
      ipcRenderer.invoke('verification:getBatchScores', repoIds) as Promise<Record<string, { tier: string | null; signals: string[] }>>,
    onUpdated: (cb: (data: { repoId: string; tier: string | null; signals: string[] }) => void) => {
      const wrapper = ((_: unknown, data: { repoId: string; tier: string | null; signals: string[] }) => cb(data)) as (...args: unknown[]) => void
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('verification:updated', wrapper)
    },
    offUpdated: (cb: (data: { repoId: string; tier: string | null; signals: string[] }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('verification:updated', wrapper)
        callbackWrappers.delete(cb)
      }
    },
  },

  linkPreview: {
    fetch: (url: string) => ipcRenderer.invoke('fetch-link-preview', url),
  },

  download: {
    rawFile:    (params: { owner: string; name: string; branch: string; path: string }) =>
      ipcRenderer.invoke('download:rawFile', params),
    rawFolder:  (params: { owner: string; name: string; branch: string; path: string }) =>
      ipcRenderer.invoke('download:rawFolder', params),
    convert:    (params: { owner: string; name: string; branch: string; path: string; format: 'docx' | 'pdf' | 'epub'; isFolder: boolean }) =>
      ipcRenderer.invoke('download:convert', params),
    repoZip:        (owner: string, name: string) =>
      ipcRenderer.invoke('download:repoZip', owner, name),
    pickFolder:     () => ipcRenderer.invoke('download:pickFolder'),
    getDefaultFolder: () => ipcRenderer.invoke('download:getDefaultFolder') as Promise<string>,
    repoConverted: (owner: string, name: string, format: 'pdf' | 'docx' | 'epub') =>
      ipcRenderer.invoke('download:repoConverted', owner, name, format),
    bookmarks: (owner: string, name: string) =>
      ipcRenderer.invoke('download:bookmarks', owner, name),
    topLevelFolders: (owner: string, name: string) =>
      ipcRenderer.invoke('download:topLevelFolders', owner, name) as Promise<string[]>,
  },

  ai: {
    getChats: () => ipcRenderer.invoke('ai:getChats'),
    getChat: (id: number) => ipcRenderer.invoke('ai:getChat', id),
    saveChat: (chat: { id?: number; title: string; messages: unknown[] }) =>
      ipcRenderer.invoke('ai:saveChat', chat),
    deleteChat: (id: number) => ipcRenderer.invoke('ai:deleteChat', id),
    sendMessage: (payload: {
      messages: unknown[]
      starredRepos: string[]
      installedSkills: string[]
      pageContext?: string
      agentId?: string | null
      modelRef?: { provider: string; model: string; endpoint?: string }
    }) =>
      ipcRenderer.invoke('ai:sendMessage', payload) as Promise<{ text: string; html: string }>,
    onStreamToken: (cb: (token: string) => void) => {
      const wrapper = (_event: unknown, token: string) => cb(token)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('ai:stream-token', wrapper)
    },
    offStreamToken: (cb: (token: string) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('ai:stream-token', wrapper)
        callbackWrappers.delete(cb)
      }
    },
    onStreamEvent: (cb: (event: { type: string; [k: string]: unknown }) => void) => {
      const wrapper = (_event: unknown, ev: { type: string; [k: string]: unknown }) => cb(ev)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('ai:stream-event', wrapper)
    },
    offStreamEvent: (cb: (event: { type: string; [k: string]: unknown }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('ai:stream-event', wrapper)
        callbackWrappers.delete(cb)
      }
    },
  },

  tts: {
    synthesize: (text: string, voiceName: string) =>
      ipcRenderer.invoke('tts:synthesize', { text, voiceName }),
    getVoices: () => ipcRenderer.invoke('tts:getVoices'),
    checkAvailable: () => ipcRenderer.invoke('tts:checkAvailable'),
  },

  create: {
    getTemplates: () => ipcRenderer.invoke('create:getTemplates'),
    startSession: (payload: { templateId: string; toolType: string; name: string }) =>
      ipcRenderer.invoke('create:startSession', payload),
    getSessions: () => ipcRenderer.invoke('create:getSessions'),
    getSession: (id: string) => ipcRenderer.invoke('create:getSession', id),
    updateName: (id: string, name: string) => ipcRenderer.invoke('create:updateName', id, name),
    updateRepos: (id: string, repoIds: string[]) => ipcRenderer.invoke('create:updateRepos', id, repoIds),
    deleteSession: (id: string) => ipcRenderer.invoke('create:deleteSession', id),
    sendMessage: (payload: unknown) => ipcRenderer.invoke('create:sendMessage', payload),
    startWebPreview: (sessionId: string, localPath: string) => ipcRenderer.invoke('create:startWebPreview', sessionId, localPath),
    stopPreview: (sessionId: string) => ipcRenderer.invoke('create:stopPreview', sessionId),
    spawnMcp: (sessionId: string, entryPoint: string, cwd: string) => ipcRenderer.invoke('create:spawnMcp', sessionId, entryPoint, cwd),
    getMcpTools: (sessionId: string) => ipcRenderer.invoke('create:getMcpTools', sessionId),
    launchWidget: (sessionId: string, localPath: string) => ipcRenderer.invoke('create:launchWidget', sessionId, localPath),
    detachWidget: (sessionId: string) => ipcRenderer.invoke('create:detachWidget', sessionId),
    relaunchWidget: (sessionId: string, localPath: string) => ipcRenderer.invoke('create:relaunchWidget', sessionId, localPath),
    getSuggestions: (templateId: string, repoIds: string[]) => ipcRenderer.invoke('create:getSuggestions', templateId, repoIds),
    openFolder: (localPath: string) => ipcRenderer.invoke('create:openFolder', localPath),
    getFileContent: (localPath: string, filePath: string) => ipcRenderer.invoke('create:getFileContent', localPath, filePath),
    publishToGitHub: (payload: unknown) => ipcRenderer.invoke('create:publishToGitHub', payload),
    pushUpdate: (payload: unknown) => ipcRenderer.invoke('create:pushUpdate', payload),
    onStreamToken: (cb: (data: { sessionId: string; token: string }) => void) => {
      const wrapper = (_: unknown, data: { sessionId: string; token: string }) => cb(data)
      callbackWrappers.set(cb, wrapper)
      ipcRenderer.on('create:stream-token', wrapper)
    },
    offStreamToken: (cb: (data: { sessionId: string; token: string }) => void) => {
      const wrapper = callbackWrappers.get(cb)
      if (wrapper) {
        ipcRenderer.removeListener('create:stream-token', wrapper)
        callbackWrappers.delete(cb)
      }
    },
  },

  projects: {
    scanFolder:    (folderPath: string) => ipcRenderer.invoke('projects:scanFolder', folderPath),
    openFolder:    (folderPath: string) => ipcRenderer.invoke('projects:openFolder', folderPath),
    readFile:      (folderPath: string, filename: string) => ipcRenderer.invoke('projects:readFile', folderPath, filename),
    listDir:       (folderPath: string, subPath: string) => ipcRenderer.invoke('projects:listDir', folderPath, subPath),
    renameFolder:  (folderPath: string, newName: string) => ipcRenderer.invoke('projects:renameFolder', folderPath, newName),
    writeFile:     (folderPath: string, filename: string, content: string) => ipcRenderer.invoke('projects:writeFile', folderPath, filename, content),
  },

  engagement: {
    logClick: (repoId: string, source: string) =>
      ipcRenderer.invoke('engagement:logClick', repoId, source),
    getRecentlyVisited: (limit?: number) =>
      ipcRenderer.invoke('engagement:getRecentlyVisited', limit),
  },

  skillSync: {
    setup: () => ipcRenderer.invoke('skillSync:setup'),
    disconnect: () => ipcRenderer.invoke('skillSync:disconnect'),
    retryFailed: () => ipcRenderer.invoke('skillSync:retryFailed'),
    getStatus: () => ipcRenderer.invoke('skillSync:getStatus'),
    onSyncFailed: (cb: (payload: { owner?: string; filename?: string; summary?: boolean; failCount?: number }) => void) => {
      const wrapped = ((_: unknown, payload: { owner?: string; filename?: string; summary?: boolean; failCount?: number }) => cb(payload)) as (...args: unknown[]) => void
      callbackWrappers.set(cb, wrapped)
      ipcRenderer.on('skillSync:syncFailed', wrapped)
    },
    offSyncFailed: (cb: (payload: { owner?: string; filename?: string; summary?: boolean; failCount?: number }) => void) => {
      const wrapped = callbackWrappers.get(cb)
      if (wrapped) {
        ipcRenderer.removeListener('skillSync:syncFailed', wrapped)
        callbackWrappers.delete(cb)
      }
    },
  },

  notes: {
    get:            (repoId: string) =>
      ipcRenderer.invoke('notes:get', repoId),
    set:            (repoId: string, notes: string) =>
      ipcRenderer.invoke('notes:set', repoId, notes),
    pullFromGitHub: (repoId: string, owner: string, repoName: string) =>
      ipcRenderer.invoke('notes:pullFromGitHub', repoId, owner, repoName),
  },

  updates: {
    checkNow:        ()                => ipcRenderer.invoke('update:check-now'),
    lastChecked:     ()                => ipcRenderer.invoke('update:last-checked') as Promise<{ timestamp: number | null }>,
    getChanges:      (id: string)      => ipcRenderer.invoke('update:get-changes', id),
    applyForkSync:   (id: string)      => ipcRenderer.invoke('update:apply-fork-sync', id) as Promise<{ ok: boolean; error?: string }>,
    applySkillRegen: (id: string)      => ipcRenderer.invoke('update:apply-skill-regen', id) as Promise<{ ok: boolean; error?: string }>,
    restartService:  ()                => ipcRenderer.invoke('update:restart-service'),
    onStatusChanged: (cb: (payload: { ids: string[] }) => void) => {
      const wrapped = ((_: unknown, payload: { ids: string[] }) => cb(payload)) as (...args: unknown[]) => void
      callbackWrappers.set(cb, wrapped)
      ipcRenderer.on('update:status-changed', wrapped)
    },
    offStatusChanged: (cb: (payload: { ids: string[] }) => void) => {
      const wrapped = callbackWrappers.get(cb)
      if (wrapped) {
        ipcRenderer.removeListener('update:status-changed', wrapped)
        callbackWrappers.delete(cb)
      }
    },
    onToast: (cb: (payload: { message: string }) => void) => {
      const wrapped = ((_: unknown, payload: { message: string }) => cb(payload)) as (...args: unknown[]) => void
      callbackWrappers.set(cb, wrapped)
      ipcRenderer.on('update:toast', wrapped)
    },
    offToast: (cb: (payload: { message: string }) => void) => {
      const wrapped = callbackWrappers.get(cb)
      if (wrapped) {
        ipcRenderer.removeListener('update:toast', wrapped)
        callbackWrappers.delete(cb)
      }
    },
  },

})
