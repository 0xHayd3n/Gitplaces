// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildUserProfile } from './userProfile'
import { computeCorpusStats } from './corpusStats'

const NOW = Date.UTC(2026, 3, 15)

function makeRepo(overrides: any = {}) {
  return {
    id: 'x', owner: 'o', name: 'n',
    description: null, language: null, topics: '[]', stars: 100,
    starred_at: null, saved_at: null, pushed_at: null,
    type_bucket: null, type_sub: null,
    ...overrides,
  }
}

describe('buildUserProfile', () => {
  it('produces all required UserProfile fields', () => {
    const userRepos = [makeRepo({ topics: JSON.stringify(['rust']), description: 'rust parser', language: 'Rust', type_bucket: 'dev-tools', type_sub: 'cli', starred_at: new Date(NOW).toISOString(), pushed_at: new Date(NOW - 30*86400000).toISOString() })]
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({
      userRepos: userRepos as any,
      corpus,
      engagementEvents: [],
      clickedReposById: new Map(),
      now: NOW,
    })
    expect(profile.topicAffinity).toBeInstanceOf(Map)
    expect(profile.descriptionAffinity).toBeInstanceOf(Map)
    expect(profile.bucketDistribution).toBeInstanceOf(Map)
    expect(profile.subTypeDistribution).toBeInstanceOf(Map)
    expect(profile.languageWeights).toBeInstanceOf(Map)
    expect(profile.starScale.median).toBe(100)
    expect(profile.anchorPool.length).toBe(1)
    expect(profile.repoCount).toBe(1)
    expect(profile.freshnessPreference).toBeGreaterThan(0)
    expect(profile.engagement.clickCount).toBe(0)
  })

  it('anchorPool includes ALL user repos (Fix H: no 20-cap)', () => {
    // Construct 30 user repos with distinct ids to verify none are dropped
    const userRepos = Array.from({ length: 30 }, (_, i) =>
      makeRepo({
        id: `r${i}`, name: `repo-${i}`,
        topics: JSON.stringify(['rust']),
        starred_at: new Date(NOW - i * 86400000).toISOString(),
      }),
    )
    const corpus = computeCorpusStats(userRepos)
    const profile = buildUserProfile({
      userRepos: userRepos as any,
      corpus,
      engagementEvents: [],
      clickedReposById: new Map(),
      now: NOW,
    })
    expect(profile.anchorPool.length).toBe(30)
  })

  it('integrates engagement events into profile.engagement', () => {
    const userRepos = [makeRepo({ topics: JSON.stringify(['rust']) })]
    const corpus = computeCorpusStats(userRepos)
    const events = [{ id: 1, repo_id: 'r1', event_type: 'click', source: 'recommended', ts: NOW }]
    const clickedRepos = new Map([['r1', { topics: JSON.stringify(['ai']), owner: 'openai' }]])
    const profile = buildUserProfile({
      userRepos: userRepos as any,
      corpus,
      engagementEvents: events,
      clickedReposById: clickedRepos,
      now: NOW,
    })
    expect(profile.engagement.clickCount).toBe(1)
    expect(profile.engagement.clickedTopicAffinity.get('ai')).toBeGreaterThan(0)
  })
})
