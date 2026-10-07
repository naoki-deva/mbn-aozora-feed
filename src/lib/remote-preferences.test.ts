import { describe, expect, it, vi } from 'vitest'
import { AtpAgent } from '@atproto/api'
import { readAccountPreferences } from './remote-preferences'
describe('read-only preference loading', () => {
  it('never saves or auto-adds Following when preferences are absent', async () => {
    const agent = new AtpAgent({ service: 'https://bsky.social' })
    vi.spyOn(agent.app.bsky.actor, 'getPreferences').mockResolvedValue({
      data: { preferences: [] },
      success: true,
      headers: {},
    })
    const put = vi.spyOn(agent.app.bsky.actor, 'putPreferences')
    const prefs = await readAccountPreferences(agent)
    expect(prefs.savedFeeds).toEqual([])
    expect(put).not.toHaveBeenCalled()
  })
  it('preserves explicit v2 ordering including an intentionally empty selection', async () => {
    const agent = new AtpAgent({ service: 'https://bsky.social' })
    vi.spyOn(agent.app.bsky.actor, 'getPreferences').mockResolvedValue({
      data: { preferences: [{ $type: 'app.bsky.actor.defs#savedFeedsPrefV2', items: [] }] },
      success: true,
      headers: {},
    })
    expect((await readAccountPreferences(agent)).savedFeeds).toEqual([])
  })
  it('applies account moderation and subscribes to custom labelers without writing', async () => {
    const agent = new AtpAgent({ service: 'https://bsky.social' })
    const labeler = 'did:plc:abcdefghijklmnopqrstuvwx'
    vi.spyOn(agent.app.bsky.actor, 'getPreferences').mockResolvedValue({
      data: {
        preferences: [
          { $type: 'app.bsky.actor.defs#labelersPref', labelers: [{ did: labeler }] },
          {
            $type: 'app.bsky.actor.defs#contentLabelPref',
            label: 'spam',
            visibility: 'hide',
            labelerDid: labeler,
          },
          { $type: 'app.bsky.actor.defs#adultContentPref', enabled: true },
          {
            $type: 'app.bsky.actor.defs#mutedWordsPref',
            items: [{ value: 'spoiler', targets: ['content'], actorTarget: 'all' }],
          },
        ],
      },
      success: true,
      headers: {},
    })
    const result = await readAccountPreferences(agent)
    expect(result.moderationPrefs.adultContentEnabled).toBe(true)
    expect(result.moderationPrefs.labelers.find((l) => l.did === labeler)?.labels.spam).toBe('hide')
    expect(agent.labelers).toContain(labeler)
    expect(result.moderationPrefs.mutedWords[0].value).toBe('spoiler')
  })
})
