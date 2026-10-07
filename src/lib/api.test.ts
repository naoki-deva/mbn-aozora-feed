import { describe, expect, it, vi } from 'vitest'
import { AtpAgent, type ComAtprotoRepoApplyWrites, type AtpSessionData } from '@atproto/api'
import { defaults } from './preferences'
import {
  publishPost,
  visibleFeed,
  deleteRecord,
  type FeedItem,
  type PostDraft,
  type Post,
} from './api'
const did = 'did:plc:abcdefghijklmnopqrstuvwx'
const cid = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
const makePost = (id: string, extra = {}): Post => ({
  uri: `at://${did}/app.bsky.feed.post/${id}`,
  cid,
  author: { did, handle: 'test.bsky.social' },
  record: {
    $type: 'app.bsky.feed.post',
    text: 'hello',
    createdAt: new Date().toISOString(),
    ...extra,
  },
  indexedAt: new Date().toISOString(),
})
const base: PostDraft = {
  text: 'こんにちは 🇯🇵',
  images: [],
  language: 'ja',
  adult: false,
  replyRule: 'all',
  allowQuotes: true,
}
function authed() {
  const agent = new AtpAgent({ service: 'https://bsky.social' })
  agent.sessionManager.session = {
    did,
    handle: 'test.bsky.social',
    accessJwt: 'a',
    refreshJwt: 'r',
    active: true,
  } satisfies AtpSessionData
  return agent
}
describe('feed visibility', () => {
  it('filters replies, reposts and quotes and deduplicates paginated posts', () => {
    const normal = makePost('normal')
    const reply = makePost('reply', {
      reply: { parent: { uri: normal.uri, cid }, root: { uri: normal.uri, cid } },
    })
    const repost: FeedItem = {
      post: makePost('repost'),
      reason: {
        $type: 'app.bsky.feed.defs#reasonRepost',
        by: normal.author,
        indexedAt: normal.indexedAt,
      },
    }
    const quote = {
      ...makePost('quote'),
      embed: {
        $type: 'app.bsky.embed.record#view' as const,
        record: {
          $type: 'app.bsky.embed.record#viewNotFound' as const,
          uri: normal.uri,
          notFound: true,
        },
      },
    }
    const input = [{ post: normal }, { post: reply }, repost, { post: quote }, { post: normal }]
    expect(
      visibleFeed(input, {
        ...defaults,
        showReplies: false,
        showReposts: false,
        showQuotes: false,
      }).map((i) => i.post.uri),
    ).toEqual([normal.uri])
    expect(visibleFeed(input, { ...defaults, mediaOnly: true })).toEqual([])
  })
})
describe('posting', () => {
  it('atomically creates the post and gates, with the root inherited on nested replies', async () => {
    const agent = authed()
    const parent = makePost('parent', {
      reply: {
        parent: { uri: makePost('middle').uri, cid },
        root: { uri: makePost('root').uri, cid },
      },
    })
    let captured: ComAtprotoRepoApplyWrites.InputSchema | undefined
    vi.spyOn(agent.com.atproto.repo, 'applyWrites').mockImplementation(async (input) => {
      captured = input
      const rkey = input!.writes[0].rkey!
      return {
        success: true,
        headers: {},
        data: {
          results: [
            {
              $type: 'com.atproto.repo.applyWrites#createResult',
              uri: `at://${did}/app.bsky.feed.post/${rkey}`,
              cid,
            },
          ],
        },
      }
    })
    const result = await publishPost(
      agent,
      { ...base, reply: parent, replyRule: 'following', allowQuotes: false },
      vi.fn(),
    )
    expect(captured?.writes).toHaveLength(3)
    const post = captured!.writes[0] as ComAtprotoRepoApplyWrites.Create
    expect(post.value.reply).toEqual({
      parent: { uri: parent.uri, cid },
      root: { uri: makePost('root').uri, cid },
    })
    expect((captured!.writes[1] as ComAtprotoRepoApplyWrites.Create).value.post).toBe(result.uri)
    expect((captured!.writes[2] as ComAtprotoRepoApplyWrites.Create).value.post).toBe(result.uri)
    expect(captured!.writes.map((w) => w.rkey)).toEqual([post.rkey, post.rkey, post.rkey])
  })
  it('rejects overlong posts and incompatible attachments before creating records', async () => {
    const agent = authed()
    const writes = vi.spyOn(agent.com.atproto.repo, 'applyWrites')
    await expect(publishPost(agent, { ...base, text: 'あ'.repeat(301) }, vi.fn())).rejects.toThrow(
      '300',
    )
    await expect(
      publishPost(
        agent,
        {
          ...base,
          images: [{ file: new File([], 'x.png'), alt: '' }],
          video: new File([], 'x.mp4'),
        },
        vi.fn(),
      ),
    ).rejects.toThrow('同時')
    expect(writes).not.toHaveBeenCalled()
  })
  it('cannot delete another account’s record, and correctly parses DID-based AT URIs', async () => {
    const agent = authed()
    const remove = vi
      .spyOn(agent.com.atproto.repo, 'deleteRecord')
      .mockResolvedValue({ success: true, headers: {}, data: {} })
    await expect(
      deleteRecord(agent, 'at://did:plc:other/app.bsky.graph.block/test'),
    ).rejects.toThrow('自分')
    await deleteRecord(agent, `at://${did}/app.bsky.graph.block/test`)
    expect(remove).toHaveBeenCalledWith({
      repo: did,
      collection: 'app.bsky.graph.block',
      rkey: 'test',
    })
  })
})
