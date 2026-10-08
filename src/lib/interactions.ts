import { type AtpAgent, type AppBskyFeedThreadgate, type AppBskyFeedPostgate } from '@atproto/api'
import { type Post } from './api'
export async function readGate(
  agent: AtpAgent,
  post: Post,
  collection: 'app.bsky.feed.threadgate' | 'app.bsky.feed.postgate',
) {
  try {
    return (
      await agent.com.atproto.repo.getRecord({
        repo: post.author.did,
        collection,
        rkey: post.uri.split('/').at(-1)!,
      })
    ).data
  } catch (error) {
    if (error instanceof Error && /RecordNotFound|Could not locate record/.test(error.message))
      return undefined
    throw error
  }
}
export async function setHiddenReply(
  agent: AtpAgent,
  post: Post,
  replyUri: string,
  hidden: boolean,
) {
  if (agent.session?.did !== post.author.did)
    throw new Error('自分の投稿の返信だけを管理できます。')
  const gate = await readGate(agent, post, 'app.bsky.feed.threadgate')
  const previous = gate?.value as AppBskyFeedThreadgate.Record | undefined
  const replies = [...new Set(previous?.hiddenReplies ?? [])].filter((uri) => uri !== replyUri)
  if (hidden) replies.push(replyUri)
  return agent.com.atproto.repo.putRecord({
    repo: post.author.did,
    collection: 'app.bsky.feed.threadgate',
    rkey: post.uri.split('/').at(-1)!,
    swapRecord: gate?.cid,
    record: {
      ...previous,
      $type: 'app.bsky.feed.threadgate',
      post: post.uri,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      hiddenReplies: replies,
    },
  })
}
export async function detachQuote(
  agent: AtpAgent,
  post: Post,
  quoteUri: string,
  detached: boolean,
) {
  if (agent.session?.did !== post.author.did)
    throw new Error('自分の投稿の引用だけを管理できます。')
  const gate = await readGate(agent, post, 'app.bsky.feed.postgate')
  const previous = gate?.value as AppBskyFeedPostgate.Record | undefined
  const quotes = [...new Set(previous?.detachedEmbeddingUris ?? [])].filter(
    (uri) => uri !== quoteUri,
  )
  if (detached) quotes.push(quoteUri)
  return agent.com.atproto.repo.putRecord({
    repo: post.author.did,
    collection: 'app.bsky.feed.postgate',
    rkey: post.uri.split('/').at(-1)!,
    swapRecord: gate?.cid,
    record: {
      ...previous,
      $type: 'app.bsky.feed.postgate',
      post: post.uri,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      detachedEmbeddingUris: quotes,
    },
  })
}
