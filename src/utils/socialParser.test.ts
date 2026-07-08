import { describe, it, expect } from 'vitest'
import { extractSocialPosts } from './socialParser'

describe('extractSocialPosts', () => {
  it('extracts a tweet with handle and Tweet postType', () => {
    const posts = extractSocialPosts('Check https://twitter.com/jack/status/20 out')
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      platform: 'twitter',
      handle: '@jack',
      postType: 'Tweet',
      url: 'https://twitter.com/jack/status/20',
    })
  })

  it('treats x.com the same as twitter.com', () => {
    const posts = extractSocialPosts('https://x.com/jack/status/20')
    expect(posts[0]).toMatchObject({ platform: 'twitter', postType: 'Tweet' })
  })

  it('skips bare profile/identity links (Profile, Page, Company)', () => {
    const content = [
      'https://x.com/elonmusk',                 // Profile → skipped
      'https://facebook.com/somepage',          // Page → skipped
      'https://linkedin.com/company/acme-inc',  // Company → skipped
    ].join('\n')
    expect(extractSocialPosts(content)).toEqual([])
  })

  it('skips twitter utility paths', () => {
    expect(extractSocialPosts('https://twitter.com/search?q=cats')).toEqual([])
    expect(extractSocialPosts('https://twitter.com/i/foo/bar')).toEqual([])
  })

  it('parses facebook groups and events', () => {
    const posts = extractSocialPosts(
      'https://facebook.com/groups/cool-devs and https://facebook.com/events/12345',
    )
    expect(posts).toEqual([
      expect.objectContaining({ platform: 'facebook', handle: 'cool devs', postType: 'Group' }),
      expect.objectContaining({ platform: 'facebook', handle: null, postType: 'Event' }),
    ])
  })

  it('parses linkedin posts / pulse / feed as Post', () => {
    const posts = extractSocialPosts('https://linkedin.com/posts/foo-activity-123')
    expect(posts[0]).toMatchObject({ platform: 'linkedin', postType: 'Post', handle: null })
  })

  it('strips trailing markdown punctuation from the URL', () => {
    const posts = extractSocialPosts('([link](https://twitter.com/jack/status/20)).')
    expect(posts[0].url).toBe('https://twitter.com/jack/status/20')
  })

  it('deduplicates the same URL (case-insensitive)', () => {
    const content = 'https://twitter.com/jack/status/20 https://twitter.com/Jack/status/20'
    // The two differ only in case → both kept once each? Key is lowercased, so second is a dup.
    const posts = extractSocialPosts(content)
    expect(posts).toHaveLength(1)
  })

  it('caps the result at 50 entries', () => {
    const urls = Array.from({ length: 60 }, (_, i) => `https://twitter.com/u${i}/status/${i}`)
    const posts = extractSocialPosts(urls.join(' '))
    expect(posts).toHaveLength(50)
  })

  it('returns an empty array when there are no social links', () => {
    expect(extractSocialPosts('just some plain readme text')).toEqual([])
  })
})
