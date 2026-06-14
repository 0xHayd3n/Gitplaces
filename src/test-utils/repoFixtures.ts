// Shared test fixtures for the normalized Repo / SavedRepo shape.
// Use these from component tests so each spec doesn't redefine the full
// 50-field shape inline.

import type { Repo, SavedRepo, LibrarySavedRepo } from '../types/repo'

export function fixtureRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    hostId: 'gh:api.github.com',
    hostType: 'github',
    hostNativeId: 1,
    fullName: 'octocat/Hello-World',
    owner: 'octocat',
    name: 'Hello-World',
    htmlUrl: 'https://github.com/octocat/Hello-World',
    homepageUrl: null,
    description: null,
    language: null,
    topics: [],
    license: null,
    defaultBranch: 'main',
    archived: false,
    size: 0,
    stars: 0,
    forks: 0,
    watchers: 0,
    openIssues: 0,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    pushedAt: '2026-01-01T00:00:00Z',
    ownerAvatarUrl: 'https://x/a.png',
    ...overrides,
  }
}

export function fixtureSavedRepo(overrides: Partial<SavedRepo> = {}): SavedRepo {
  return {
    ...fixtureRepo(),
    savedAt: null,
    starredAt: null,
    unstarredAt: null,
    discoveredAt: null,
    discoverQuery: null,
    bannerSvg: null,
    bannerColor: null,
    ogImageUrl: null,
    type: null,
    typeBucket: null,
    typeSub: null,
    translatedDescription: null,
    translatedDescriptionLang: null,
    translatedReadme: null,
    translatedReadmeLang: null,
    detectedLanguage: null,
    verificationScore: null,
    verificationTier: null,
    verificationSignals: null,
    verificationCheckedAt: null,
    isForked: null,
    updateAvailable: null,
    updateCheckedAt: null,
    upstreamVersion: null,
    storedVersion: null,
    archivedAt: null,
    forkedAt: null,
    fetchedAt: null,
    starredCheckedAt: null,
    storybookUrl: null,
    ...overrides,
  }
}

export function fixtureLibrarySavedRepo(
  overrides: Partial<LibrarySavedRepo> = {},
): LibrarySavedRepo {
  return {
    ...fixtureSavedRepo(),
    installed: 1,
    active: 1,
    version: null,
    generatedAt: null,
    enabledComponents: null,
    enabledTools: null,
    tier: 1,
    ...overrides,
  }
}
