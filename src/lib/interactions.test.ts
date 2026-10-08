import { AtpAgent } from '@atproto/api'
import { describe, expect, it, vi } from 'vitest'
import { detachQuote, setHiddenReply } from './interactions'
import type { Post } from './api'
const did = 'did:plc:abcdefghijklmnopqrstuvwx'
const post: Post = {
  uri: `at://${did}/app.bsky.feed.post/test`,
  cid: 'cid',
  author: { did, handle: 'me.bsky.social' },
  record: {},
  indexedAt: new Date().toISOString(),
}
function authed() {
  const agent = new AtpAgent({ service: 'https://bsky.social' })
  agent.sessionManager.session = {
    did,
    handle: 'me.bsky.social',
    accessJwt: 'a',
    refreshJwt: 'r',
    active: true,
  }
  return agent
}
it('changing hidden replies preserves reply permissions and uses a record lease', async () => {
  const agent = authed()
  vi.spyOn(agent.com.atproto.repo, 'getRecord').mockResolvedValue({
    success: true,
    headers: {},
    data: {
      uri: 'gate',
      cid: 'old-cid',
      value: {
        $type: 'app.bsky.feed.threadgate',
        post: post.uri,
        createdAt: '2026-01-01T00:00:00.000Z',
        allow: [],
        hiddenReplies: ['at://did:plc:other/app.bsky.feed.post/old'],
      },
    },
  })
  const put = vi
    .spyOn(agent.com.atproto.repo, 'putRecord')
    .mockResolvedValue({ success: true, headers: {}, data: { uri: 'gate', cid: 'new-cid' } })
  const reply = 'at://did:plc:other/app.bsky.feed.post/new'
  await setHiddenReply(agent, post, reply, true)
  expect(put).toHaveBeenCalledWith(
    expect.objectContaining({
      swapRecord: 'old-cid',
      record: expect.objectContaining({
        allow: [],
        hiddenReplies: ['at://did:plc:other/app.bsky.feed.post/old', reply],
      }),
    }),
  )
})
it('restoring a detached quote preserves disabled quoting and other detachments', async () => {
  const agent = authed()
  vi.spyOn(agent.com.atproto.repo, 'getRecord').mockResolvedValue({
    success: true,
    headers: {},
    data: {
      uri: 'gate',
      cid: 'old-cid',
      value: {
        $type: 'app.bsky.feed.postgate',
        post: post.uri,
        createdAt: '2026-01-01T00:00:00.000Z',
        embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
        detachedEmbeddingUris: ['quote-1', 'quote-2'],
      },
    },
  })
  const put = vi
    .spyOn(agent.com.atproto.repo, 'putRecord')
    .mockResolvedValue({ success: true, headers: {}, data: { uri: 'gate', cid: 'new-cid' } })
  await detachQuote(agent, post, 'quote-1', false)
  expect(put).toHaveBeenCalledWith(
    expect.objectContaining({
      swapRecord: 'old-cid',
      record: expect.objectContaining({
        embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
        detachedEmbeddingUris: ['quote-2'],
      }),
    }),
  )
})
describe('ownership', () => {
  it('rejects attempts to hide replies or detach quotes on someone else’s post', async () => {
    const agent = authed()
    const foreign = { ...post, author: { ...post.author, did: 'did:plc:other' } }
    const put = vi.spyOn(agent.com.atproto.repo, 'putRecord')
    await expect(setHiddenReply(agent, foreign, 'reply', true)).rejects.toThrow('自分')
    await expect(detachQuote(agent, foreign, 'quote', true)).rejects.toThrow('自分')
    expect(put).not.toHaveBeenCalled()
  })
})
