import { beforeEach, describe, expect, it } from 'vitest'
import {
  defaults,
  following,
  readPreferences,
  writePreferences,
  startupPreferences,
  normalizePreferences,
  safeUrl,
  graphemeLength,
} from './preferences'
const feed = {
  id: 'at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.generator/art',
  uri: 'at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.generator/art',
  kind: 'feed' as const,
  name: 'Art',
}
beforeEach(() => localStorage.clear())
describe('freedom of feed choice', () => {
  it('does not inject any feed or default for a new visitor', () => {
    expect(readPreferences().feeds).toEqual([])
    expect(readPreferences().homeFeed).toBeNull()
    expect(readPreferences().onboarded).toBe(false)
  })
  it('keeps an explicitly empty home empty', () => {
    writePreferences('guest', { ...defaults, onboarded: true })
    expect(readPreferences().feeds).toEqual([])
    expect(readPreferences().onboarded).toBe(true)
  })
  it('isolates guest and account preferences', () => {
    writePreferences('guest', { ...defaults, feeds: [feed] })
    writePreferences('did:plc:me', { ...defaults, feeds: [following] })
    expect(readPreferences('guest').feeds).toEqual([feed])
    expect(readPreferences('did:plc:me').feeds).toEqual([following])
  })
  it('uses the chosen home feed on startup, preserving ordinary selection when reading', () => {
    writePreferences('guest', {
      ...defaults,
      feeds: [feed, following],
      selectedFeed: 'following',
      homeFeed: feed.id,
    })
    expect(readPreferences().selectedFeed).toBe('following')
    expect(startupPreferences().selectedFeed).toBe(feed.id)
  })
  it('recovers from corrupted storage and rejects fake sources and unknown options', () => {
    localStorage.setItem('aozora:prefs:guest', '{broken')
    expect(readPreferences()).toEqual(defaults)
    localStorage.setItem(
      'aozora:prefs:guest',
      JSON.stringify({
        theme: 'invented',
        hideCounts: 'yes',
        feeds: [
          { ...feed, kind: 'list' },
          { kind: 'following', id: 'fake', name: 'fake' },
          feed,
          feed,
        ],
      }),
    )
    expect(readPreferences().feeds).toEqual([feed])
    expect(readPreferences().theme).toBe('system')
    expect(readPreferences().hideCounts).toBe(false)
  })
  it('removing a selected source does not leave dangling defaults', () => {
    expect(
      normalizePreferences({ ...defaults, feeds: [], selectedFeed: feed.id, homeFeed: feed.id }),
    ).toMatchObject({ feeds: [], selectedFeed: null, homeFeed: null })
  })
})
describe('untrusted content', () => {
  it('allows web links and rejects executable and credential-bearing non-web schemes', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com/')
    expect(safeUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeUrl('data:text/html,evil')).toBeUndefined()
    expect(safeUrl('/relative')).toBeUndefined()
  })
  it('counts graphemes instead of UTF-16 units for Japanese and emoji posts', () => {
    expect(graphemeLength('あおぞら')).toBe(4)
    expect(graphemeLength('👨‍👩‍👧‍👦🇯🇵e\u0301')).toBe(3)
  })
})
