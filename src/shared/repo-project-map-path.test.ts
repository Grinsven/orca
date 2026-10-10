import { describe, expect, it } from 'vitest'
import { normalizeRepoProjectMapPath, RepoProjectMapPathUpdate } from './repo-project-map-path'

describe('normalizeRepoProjectMapPath', () => {
  it.each([
    '/srv/repo/docs/project-map.html',
    '/srv/repo/MAP.HTM',
    String.raw`C:\Repos\My repo\map.html`,
    'C:/Repos/map.htm',
    String.raw`\\wsl.localhost\Ubuntu\home\me\map.html`
  ])('accepts the absolute HTML path %s', (value) => {
    expect(normalizeRepoProjectMapPath(value)).toBe(value)
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeRepoProjectMapPath('  /srv/repo/map.html\n')).toBe('/srv/repo/map.html')
  })

  it.each(['docs/map.html', './map.html', 'map.html', String.raw`Repos\map.html`])(
    'rejects the relative path %s',
    (value) => {
      expect(normalizeRepoProjectMapPath(value)).toBeNull()
    }
  )

  it.each(['/srv/repo/map.md', '/srv/repo/map.html.bak', '/srv/repo/map', '', '   '])(
    'rejects the non-HTML value %j',
    (value) => {
      expect(normalizeRepoProjectMapPath(value)).toBeNull()
    }
  )
})

describe('RepoProjectMapPathUpdate', () => {
  it('passes null through as the clear sentinel and leaves an omitted field undefined', () => {
    expect(RepoProjectMapPathUpdate.parse(null)).toBeNull()
    expect(RepoProjectMapPathUpdate.parse(undefined)).toBeUndefined()
  })

  it('stores the trimmed path', () => {
    expect(RepoProjectMapPathUpdate.parse(' /srv/repo/map.html ')).toBe('/srv/repo/map.html')
  })

  it.each(['docs/map.html', '/srv/repo/map.md', 42])('rejects %j', (value) => {
    expect(RepoProjectMapPathUpdate.safeParse(value).success).toBe(false)
  })
})
