import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  type AppBskyFeedThreadgate,
  type AppBskyFeedPostgate,
  type ComAtprotoRepoApplyWrites,
} from '@atproto/api'
import { useApp } from '../lib/context'
import { type Post } from '../lib/api'
import { ErrorState, Modal, Spinner, useAction } from './ui'
import { readGate } from '../lib/interactions'
function Editor({
  post,
  thread,
  quote,
  onClose,
}: {
  post: Post
  thread?: Awaited<ReturnType<typeof readGate>>
  quote?: Awaited<ReturnType<typeof readGate>>
  onClose: () => void
}) {
  const { agent, did } = useApp()
  const existing = thread?.value as AppBskyFeedThreadgate.Record | undefined
  const current = quote?.value as AppBskyFeedPostgate.Record | undefined
  const rule =
    existing?.allow === undefined
      ? 'all'
      : existing.allow.length === 0
        ? 'none'
        : existing.allow[0].$type === 'app.bsky.feed.threadgate#followingRule'
          ? 'following'
          : existing.allow[0].$type === 'app.bsky.feed.threadgate#followerRule'
            ? 'followers'
            : existing.allow[0].$type === 'app.bsky.feed.threadgate#mentionRule'
              ? 'mentioned'
              : 'custom'
  const [replyRule, setReplyRule] = useState(rule)
  const [allowQuotes, setAllowQuotes] = useState(
    !current?.embeddingRules?.some((r) => r.$type === 'app.bsky.feed.postgate#disableRule'),
  )
  const save = useAction(
    async () => {
      if (did !== post.author.did) throw new Error('自分の投稿だけを編集できます。')
      const rkey = post.uri.split('/').at(-1)!
      const commit = await agent.com.atproto.sync.getLatestCommit({ did: did! })
      const freshThread = await readGate(agent, post, 'app.bsky.feed.threadgate')
      const freshQuote = await readGate(agent, post, 'app.bsky.feed.postgate')
      // Do not overwrite changes made in another tab/client while this editor was open.
      if (freshThread?.cid !== thread?.cid || freshQuote?.cid !== quote?.cid)
        throw new Error('設定が別の場所で変更されました。一度閉じて、開き直してください。')
      const allow: AppBskyFeedThreadgate.Record['allow'] =
        replyRule === 'custom'
          ? existing?.allow
          : replyRule === 'all'
            ? undefined
            : replyRule === 'none'
              ? []
              : [
                  {
                    $type: `app.bsky.feed.threadgate#${replyRule === 'followers' ? 'follower' : replyRule === 'mentioned' ? 'mention' : 'following'}Rule`,
                  },
                ]
      const createdAt = new Date().toISOString()
      const writes: ComAtprotoRepoApplyWrites.InputSchema['writes'] = [
        {
          $type: thread
            ? 'com.atproto.repo.applyWrites#update'
            : 'com.atproto.repo.applyWrites#create',
          collection: 'app.bsky.feed.threadgate',
          rkey,
          value: {
            ...existing,
            $type: 'app.bsky.feed.threadgate',
            post: post.uri,
            createdAt: existing?.createdAt ?? createdAt,
            allow,
          },
        },
        {
          $type: quote
            ? 'com.atproto.repo.applyWrites#update'
            : 'com.atproto.repo.applyWrites#create',
          collection: 'app.bsky.feed.postgate',
          rkey,
          value: {
            ...current,
            $type: 'app.bsky.feed.postgate',
            post: post.uri,
            createdAt: current?.createdAt ?? createdAt,
            embeddingRules: allowQuotes ? [] : [{ $type: 'app.bsky.feed.postgate#disableRule' }],
          },
        },
      ]
      return agent.com.atproto.repo.applyWrites({
        repo: did!,
        swapCommit: commit.data.cid,
        writes,
        validate: true,
      })
    },
    '返信と引用の設定を更新しました',
    onClose,
  )
  return (
    <form
      className="modal-body stack"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <label>
        返信できる人
        <select value={replyRule} onChange={(e) => setReplyRule(e.target.value)}>
          <option value="all">全員</option>
          <option value="following">フォローしている人</option>
          <option value="followers">フォロワー</option>
          <option value="mentioned">メンションした人</option>
          <option value="none">返信を許可しない</option>
          {rule === 'custom' && <option value="custom">既存のカスタム設定を維持</option>}
        </select>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={allowQuotes}
          onChange={(e) => setAllowQuotes(e.target.checked)}
        />
        引用を許可する
      </label>
      <button className="button" disabled={save.isPending}>
        {save.isPending ? '保存中…' : '設定を保存する'}
      </button>
    </form>
  )
}
export function InteractionSettings({ post, onClose }: { post: Post; onClose: () => void }) {
  const { agent, did } = useApp()
  const gates = useQuery({
    queryKey: [did, 'interactionGates', post.uri],
    queryFn: async () => ({
      thread: await readGate(agent, post, 'app.bsky.feed.threadgate'),
      quote: await readGate(agent, post, 'app.bsky.feed.postgate'),
    }),
  })
  return (
    <Modal title="返信と引用の設定" onClose={onClose}>
      {gates.isPending ? (
        <Spinner />
      ) : gates.isError ? (
        <ErrorState error={gates.error} retry={() => void gates.refetch()} />
      ) : (
        <Editor post={post} thread={gates.data.thread} quote={gates.data.quote} onClose={onClose} />
      )}
    </Modal>
  )
}
