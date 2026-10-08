import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { AppBskyFeedDefs, type AppBskyFeedThreadgate, type AppBskyFeedPostgate } from '@atproto/api'
import { useApp } from '../lib/context'
import { type Post } from '../lib/api'
import { readGate, setHiddenReply, detachQuote } from '../lib/interactions'
import { PostCard } from '../components/PostCard'
import { ProfileCard } from '../components/ProfileCard'
import {
  PageHeader,
  Spinner,
  ErrorState,
  Empty,
  Modal,
  LoadMore,
  useAction,
} from '../components/ui'
function Replies({
  nodes,
  level = 0,
  hidden,
  showHidden,
  onHide,
  pending,
  sort,
}: {
  nodes: AppBskyFeedDefs.ThreadViewPost['replies']
  level?: number
  hidden: string[]
  showHidden: boolean
  onHide?: (uri: string, hide: boolean) => void
  pending: boolean
  sort: string
}) {
  if (!nodes?.length) return null
  const ordered = [...nodes].sort((a, b) => {
    if (!AppBskyFeedDefs.isThreadViewPost(a) || !AppBskyFeedDefs.isThreadViewPost(b)) return 0
    if (sort === 'likes') return (b.post.likeCount ?? 0) - (a.post.likeCount ?? 0)
    const delta = Date.parse(a.post.indexedAt) - Date.parse(b.post.indexedAt)
    return sort === 'newest' ? -delta : delta
  })
  return (
    <div className={`thread-replies ${level ? 'nested' : ''}`}>
      {ordered.map((node, i) => {
        if (!AppBskyFeedDefs.isThreadViewPost(node))
          return (
            <div key={i} className="post-warning">
              返信は削除済み、またはブロックされているため表示できません。
            </div>
          )
        const isHidden = hidden.includes(node.post.uri)
        if (isHidden && !showHidden)
          return (
            <div key={node.post.uri} className="post-warning">
              投稿者がこの返信を非表示にしています。
            </div>
          )
        return (
          <div key={node.post.uri}>
            <PostCard post={node.post} />
            {onHide && (
              <div className="reply-admin">
                <button
                  className="text-button"
                  disabled={pending}
                  onClick={() => onHide(node.post.uri, !isHidden)}
                >
                  {isHidden ? 'この返信を表示に戻す' : 'この返信を非表示にする'}
                </button>
              </div>
            )}
            <Replies
              nodes={node.replies}
              level={level + 1}
              hidden={hidden}
              showHidden={showHidden}
              onHide={onHide}
              pending={pending}
              sort={sort}
            />
          </div>
        )
      })}
    </div>
  )
}
function Quotes({ post, onClose }: { post: Post; onClose: () => void }) {
  const { agent, did } = useApp()
  const [sort, setSort] = useState('latest')
  const quotes = useInfiniteQuery({
    queryKey: [did, 'quotes', post.uri, sort],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await agent.app.bsky.feed.getQuotes(
          { uri: post.uri, limit: 30, cursor: pageParam, sort },
          { signal },
        )
      ).data,
    getNextPageParam: (page) => page.cursor,
  })
  const gate = useQuery({
    queryKey: [did, 'quoteGate', post.uri],
    enabled: did === post.author.did,
    queryFn: () => readGate(agent, post, 'app.bsky.feed.postgate'),
  })
  const detached =
    (gate.data?.value as AppBskyFeedPostgate.Record | undefined)?.detachedEmbeddingUris ?? []
  const action = useAction<{ uri: string; detach: boolean }>(
    (value) => detachQuote(agent, post, value.uri, value.detach),
    '引用の接続を更新しました',
  )
  return (
    <Modal title="引用した投稿" onClose={onClose} wide>
      <div className="page-body">
        <label>
          並び順
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="latest">新しい順</option>
            <option value="top">人気順</option>
          </select>
        </label>
      </div>
      {quotes.isPending ? (
        <Spinner />
      ) : quotes.isError && !quotes.data ? (
        <ErrorState error={quotes.error} />
      ) : (
        <>
          {quotes.data?.pages
            .flatMap((p) => p.posts)
            .map((quote) => (
              <div key={quote.uri}>
                <PostCard post={quote} />
                {did === post.author.did && (
                  <div className="reply-admin">
                    <button
                      className="text-button"
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({ uri: quote.uri, detach: !detached.includes(quote.uri) })
                      }
                    >
                      {detached.includes(quote.uri)
                        ? '引用の接続を戻す'
                        : '自分の投稿との引用の接続を解除'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          {!quotes.data?.pages[0].posts.length && <Empty title="まだ引用はありません" />}
          <LoadMore
            hasMore={quotes.hasNextPage}
            loading={quotes.isFetchingNextPage}
            load={() => void quotes.fetchNextPage()}
          />
          {quotes.isFetchNextPageError && (
            <ErrorState error={quotes.error} retry={() => void quotes.fetchNextPage()} />
          )}
        </>
      )}
    </Modal>
  )
}
export function Thread() {
  const { uri = '' } = useParams()
  const { agent, did } = useApp()
  const [people, setPeople] = useState<'likes' | 'reposts'>()
  const [quotes, setQuotes] = useState(false)
  const [sort, setSort] = useState('oldest')
  const [showHidden, setShowHidden] = useState(false)
  const thread = useQuery({
    queryKey: [did, 'thread', uri],
    queryFn: async ({ signal }) =>
      (await agent.getPostThread({ uri, depth: 6, parentHeight: 20 }, { signal })).data.thread,
  })
  const viewed = AppBskyFeedDefs.isThreadViewPost(thread.data) ? thread.data.post : undefined
  const gate = useQuery({
    queryKey: [did, 'replyGate', uri],
    enabled: !!viewed && viewed.author.did === did,
    queryFn: () => readGate(agent, viewed!, 'app.bsky.feed.threadgate'),
  })
  const hide = useAction<{ uri: string; hidden: boolean }>(
    (value) => setHiddenReply(agent, viewed!, value.uri, value.hidden),
    '返信の表示設定を更新しました',
  )
  const actors = useInfiniteQuery({
    queryKey: [did, 'postPeople', uri, people],
    enabled: !!people,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (people === 'likes') {
        const page = await agent.getLikes({ uri, limit: 40, cursor: pageParam }, { signal })
        return { people: page.data.likes.map((l) => l.actor), cursor: page.data.cursor }
      }
      const page = await agent.getRepostedBy({ uri, limit: 40, cursor: pageParam }, { signal })
      return { people: page.data.repostedBy, cursor: page.data.cursor }
    },
    getNextPageParam: (page) => page.cursor,
  })
  if (thread.isPending) return <Spinner />
  if (thread.isError) return <ErrorState error={thread.error} retry={() => void thread.refetch()} />
  if (!AppBskyFeedDefs.isThreadViewPost(thread.data))
    return (
      <>
        <PageHeader title="投稿" back />
        <Empty title="投稿を表示できません">削除済みか、公開されていない投稿です。</Empty>
      </>
    )
  const ancestors: AppBskyFeedDefs.ThreadViewPost[] = []
  let parent = thread.data.parent
  while (AppBskyFeedDefs.isThreadViewPost(parent)) {
    ancestors.unshift(parent)
    parent = parent.parent
  }
  const stored = gate.data?.value ?? thread.data.post.threadgate?.record
  const hidden = (stored as AppBskyFeedThreadgate.Record | undefined)?.hiddenReplies ?? []
  const own = thread.data.post.author.did === did
  return (
    <>
      <PageHeader title="投稿" back />
      {ancestors.map((node) => (
        <PostCard key={node.post.uri} post={node.post} />
      ))}
      <PostCard post={thread.data.post} detailed />
      <div className="thread-counts">
        <button className="text-button" onClick={() => setPeople('likes')}>
          いいねした人
        </button>
        <button className="text-button" onClick={() => setPeople('reposts')}>
          リポストした人
        </button>
        <button className="text-button" onClick={() => setQuotes(true)}>
          引用
        </button>
      </div>
      <div className="thread-tools">
        <span>返信</span>
        <select aria-label="返信の並び順" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="oldest">古い順</option>
          <option value="newest">新しい順</option>
          <option value="likes">いいねの多い順</option>
        </select>
        {hidden.length > 0 && (
          <button className="text-button" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? '非表示の返信を隠す' : '非表示の返信も見る'}
          </button>
        )}
      </div>
      <Replies
        nodes={thread.data.replies}
        hidden={hidden}
        showHidden={showHidden}
        onHide={own ? (uri, hidden) => hide.mutate({ uri, hidden }) : undefined}
        pending={hide.isPending}
        sort={sort}
      />
      {!thread.data.replies?.length && <Empty title="まだ返信がありません" />}
      {people && (
        <Modal
          title={people === 'likes' ? 'いいねした人' : 'リポストした人'}
          onClose={() => setPeople(undefined)}
        >
          {actors.isPending ? (
            <Spinner />
          ) : actors.isError && !actors.data ? (
            <ErrorState error={actors.error} />
          ) : (
            <>
              {actors.data?.pages
                .flatMap((p) => p.people)
                .map((p) => (
                  <ProfileCard key={p.did} profile={p} />
                ))}
              {!actors.data?.pages[0].people.length && <Empty title="まだ誰もいません" />}
              <LoadMore
                hasMore={actors.hasNextPage}
                loading={actors.isFetchingNextPage}
                load={() => void actors.fetchNextPage()}
              />
            </>
          )}
        </Modal>
      )}
      {quotes && <Quotes post={thread.data.post} onClose={() => setQuotes(false)} />}
    </>
  )
}
