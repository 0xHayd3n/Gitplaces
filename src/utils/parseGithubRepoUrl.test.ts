import { describe, it, expect } from 'vitest'
import { parseGithubRepoUrl } from './parseGithubRepoUrl'

describe('parseGithubRepoUrl — accepts', () => {
  it.each<[string, { owner: string; name: string }]>([
    ['owner/repo',                                  { owner: 'owner', name: 'repo' }],
    ['https://github.com/owner/repo',               { owner: 'owner', name: 'repo' }],
    ['https://github.com/owner/repo.git',           { owner: 'owner', name: 'repo' }],
    ['https://github.com/owner/repo/',              { owner: 'owner', name: 'repo' }],
    ['http://github.com/owner/repo',                { owner: 'owner', name: 'repo' }],
    ['HTTPS://GITHUB.COM/Owner/Repo',               { owner: 'Owner', name: 'Repo' }],
    ['git@github.com:owner/repo.git',               { owner: 'owner', name: 'repo' }],
    ['git@github.com:owner/repo',                   { owner: 'owner', name: 'repo' }],
    ['  owner/repo  ',                              { owner: 'owner', name: 'repo' }],
    ['github.com/owner/repo',                       { owner: 'owner', name: 'repo' }],
    ['github.com/owner/repo/tree/main/path',        { owner: 'owner', name: 'repo' }],
    ['https://github.com/obra/superpowers',         { owner: 'obra', name: 'superpowers' }],
    ['owner-with-dashes/repo_with.dots',            { owner: 'owner-with-dashes', name: 'repo_with.dots' }],
  ])('parses %s', (input, expected) => {
    expect(parseGithubRepoUrl(input)).toEqual(expected)
  })
})

describe('parseGithubRepoUrl — rejects', () => {
  it.each<[string]>([
    [''],
    ['   '],
    ['owner'],
    ['owner/'],
    ['/repo'],
    ['owner/repo/extra/parts/many'],
    ['https://gitlab.com/owner/repo'],
    ['github.mycorp.com/o/r'],
    ['owner/repo with space'],
    ['owner/.repo'],
    ['.owner/repo'],
    ['../etc/passwd'],
    ['https://github.com/'],
    ['https://github.com/owner'],
    ['ssh://git@github.com/owner/repo'],
  ])('rejects %s', (input) => {
    expect(parseGithubRepoUrl(input)).toBeNull()
  })
})
