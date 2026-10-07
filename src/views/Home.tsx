import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  ArrowUpRight,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Radio,
  CloudSun,
  Heart,
} from 'lucide-react'
import { moderatePost, moderateFeedGenerator } from '@atproto/api'
import { useApp, useModeration } from '../lib/context'
import { fetchFeed, visibleFeed, generatorSource } from '../lib/api'
import { following, type FeedSource } from '../lib/preferences'
import { PostCard } from '../components/PostCard'
import {
  Avatar,
  Empty,
  ErrorState,
  LoadMore,
  PageHeader,
  Spinner,
  Toggle,
  useAction,
} from '../components/ui'
import { Onboarding } from './Feeds'
export function Timeline({ source }: { source: FeedSource }) {
  const { agent, did, prefs, openLogin } = useApp()
  const { ready, error, opts } = useModeration()
  const feed = useInfiniteQuery({
    queryKey: [did, 'feed', source.id],
    enabled: source.kind !== 'following' || !!did,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchFeed(agent, source, pageParam, signal),
    getNextPageParam: (page) => page.cursor,
  })
  if (source.kind === 'following' && !did)
    return (
      <Empty icon={<CloudSun size={36} />} title="フォロー中の空へ">
        <p>ログインすると、フォローした人の投稿を表示できます。</p>
        <button className="button" onClick={openLogin}>
          ログイン
        </button>
      </Empty>
    )
  if (error) return <ErrorState error={error} />
  if (feed.isPending || !ready) return <Spinner />
  if (feed.isError && !feed.data)
    return <ErrorState error={feed.error} retry={() => void feed.refetch()} />
  const items = visibleFeed(
    feed.data!.pages.flatMap((p) => p.feed),
    prefs,
  ).filter((item) => !moderatePost(item.post, opts).ui('contentList').filter)
  return (
    <>
      <div className="timeline-meta">
        <span>
          <Radio size={13} />
          {source.name}
        </span>
        <button
          className="text-button"
          aria-label="フィードを更新"
          disabled={feed.isFetching}
          onClick={() => void feed.refetch()}
        >
          <RefreshCw size={14} className={feed.isFetching ? 'spin' : ''} />
          更新
        </button>
      </div>
      {feed.isRefetchError && <ErrorState error={feed.error} retry={() => void feed.refetch()} />}
      {items.map((item) => (
        <PostCard key={item.post.uri} post={item.post} reason={item.reason} />
      ))}
      {!items.length && (
        <Empty title="まだ投稿がありません">
          表示フィルターを見直すか、ほかのフィードを選んでみてください。
        </Empty>
      )}
      <LoadMore
        hasMore={feed.hasNextPage}
        loading={feed.isFetchingNextPage}
        load={() => void feed.fetchNextPage()}
      />
      {feed.isFetchNextPageError && (
        <ErrorState error={feed.error} retry={() => void feed.fetchNextPage()} />
      )}
    </>
  )
}
export function Home() {
  const { prefs, updatePrefs, restoring, compose } = useApp()
  const [filters, setFilters] = useState(false)
  const selected = prefs.feeds.find((f) => f.id === prefs.selectedFeed) ?? prefs.feeds[0]
  if (restoring) return <Spinner />
  if (!prefs.onboarded) return <Onboarding />
  return (
    <>
      <PageHeader
        title="あなたの空"
        eyebrow="YOUR PERSONAL SKY"
        actions={
          <button
            className={`icon-button ${filters ? 'selected' : ''}`}
            aria-label="表示フィルター"
            aria-expanded={filters}
            onClick={() => setFilters(!filters)}
          >
            <SlidersHorizontal size={19} />
          </button>
        }
      />
      <div className="feed-tabs" role="tablist" aria-label="ホームのフィード">
        {prefs.feeds.map((feed) => (
          <button
            role="tab"
            aria-selected={selected?.id === feed.id}
            key={feed.id}
            onClick={() => updatePrefs({ selectedFeed: feed.id })}
          >
            {feed.name}
          </button>
        ))}
        <Link to="/feeds" className="tab-add" aria-label="フィードを追加">
          <Plus size={18} />
        </Link>
      </div>
      {filters && (
        <div className="filter-panel">
          <h3>この空の見え方</h3>
          <Toggle
            label="返信を表示"
            checked={prefs.showReplies}
            onChange={(showReplies) => updatePrefs({ showReplies })}
          />
          <Toggle
            label="リポストを表示"
            checked={prefs.showReposts}
            onChange={(showReposts) => updatePrefs({ showReposts })}
          />
          <Toggle
            label="引用を表示"
            checked={prefs.showQuotes}
            onChange={(showQuotes) => updatePrefs({ showQuotes })}
          />
          <Toggle
            label="メディアのある投稿だけ"
            checked={prefs.mediaOnly}
            onChange={(mediaOnly) => updatePrefs({ mediaOnly })}
          />
        </div>
      )}
      <button className="inline-compose" onClick={() => compose()}>
        <Avatar name="空" size={34} />
        <span>いま、どんな空の下にいますか？</span>
        <span className="compose-plus">
          <Plus size={19} />
        </span>
      </button>
      {selected ? (
        <Timeline key={selected.id} source={selected} />
      ) : (
        <Empty icon={<CloudSun size={40} />} title="ホームを自由に作ろう">
          <p>まだフィードを選んでいません。</p>
          <Link className="button" to="/feeds">
            フィードを選ぶ <ArrowUpRight size={17} />
          </Link>
        </Empty>
      )}
    </>
  )
}
export function FeedPage() {
  const { uri = '' } = useParams()
  const { agent, did, prefs, addFeed } = useApp()
  const isList = uri.includes('/app.bsky.graph.list/')
  const info = useQuery({
    queryKey: [did, 'feedInfo', uri],
    enabled: !isList,
    queryFn: async ({ signal }) =>
      (await agent.app.bsky.feed.getFeedGenerator({ feed: uri }, { signal })).data.view,
  })
  const like = useAction(async () =>
    info.data?.viewer?.like
      ? agent.deleteLike(info.data.viewer.like)
      : agent.like(uri, info.data!.cid),
  )
  const { requireAuth } = useApp()
  const { opts, ready, error } = useModeration()
  const [reveal, setReveal] = useState(false)
  if (error) return <ErrorState error={error} />
  if (!ready || (!isList && info.isPending)) return <Spinner />
  if (!isList && info.isError)
    return <ErrorState error={info.error} retry={() => void info.refetch()} />
  const moderation = info.data
    ? moderateFeedGenerator(info.data, opts).ui('contentView')
    : undefined
  if (moderation && (moderation.filter || moderation.noOverride || (moderation.blur && !reveal)))
    return (
      <>
        <PageHeader title="フィード" back />
        <Empty title="このフィードは非表示です">
          {!moderation.filter && !moderation.noOverride && (
            <button className="button secondary" onClick={() => setReveal(true)}>
              表示する
            </button>
          )}
        </Empty>
      </>
    )
  const source: FeedSource = isList
    ? {
        kind: 'list',
        uri,
        id: uri,
        name: prefs.feeds.find((f) => f.id === uri)?.name ?? 'リストのフィード',
      }
    : info.data
      ? generatorSource(info.data)
      : following
  const added = prefs.feeds.some((f) => f.id === source.id)
  return (
    <>
      <PageHeader
        title={source.name}
        back
        actions={
          <button
            className="button small secondary"
            disabled={added}
            onClick={() => addFeed(source)}
          >
            {added ? (
              '追加済み'
            ) : (
              <>
                <Plus size={15} />
                ホームに追加
              </>
            )}
          </button>
        }
      />
      {info.data && (
        <div className="feed-detail">
          <Avatar src={info.data.avatar} name={info.data.displayName} size={54} />
          <div>
            <p>{info.data.description}</p>
            <small className="muted">by @{info.data.creator.handle}</small>
          </div>
          <button
            className={`icon-button ${info.data.viewer?.like ? 'active-like' : ''}`}
            aria-label="フィードにいいね"
            disabled={like.isPending}
            onClick={() => {
              if (requireAuth()) like.mutate()
            }}
          >
            <Heart size={19} />
          </button>
        </div>
      )}
      <Timeline source={source} />
    </>
  )
}
