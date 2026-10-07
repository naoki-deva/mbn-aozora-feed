import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Search as SearchIcon, Compass } from 'lucide-react'
import { useApp } from '../lib/context'
import { PageHeader, Spinner, ErrorState, Empty, LoadMore } from '../components/ui'
import { PostCard } from '../components/PostCard'
import { ProfileCard } from '../components/ProfileCard'
import { FeedCard } from './Feeds'
export function Search() {
  const { agent, did } = useApp()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const [input, setInput] = useState(query)
  const [tab, setTab] = useState<'posts' | 'people' | 'feeds'>('posts')
  const [sort, setSort] = useState<'latest' | 'top'>('latest')
  const [lang, setLang] = useState('')
  const [author, setAuthor] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const posts = useInfiniteQuery({
    queryKey: [did, 'searchPosts', query, sort, lang, author, since, until],
    enabled: !!query && tab === 'posts',
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await agent.app.bsky.feed.searchPosts(
          {
            q: query,
            sort,
            lang: lang || undefined,
            author: author || undefined,
            since: since || undefined,
            until: until || undefined,
            limit: 30,
            cursor: pageParam,
          },
          { signal },
        )
      ).data,
    getNextPageParam: (page) => page.cursor,
  })
  const people = useInfiniteQuery({
    queryKey: [did, 'searchPeople', query],
    enabled: !!query && tab === 'people',
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (await agent.searchActors({ q: query, limit: 30, cursor: pageParam }, { signal })).data,
    getNextPageParam: (page) => page.cursor,
  })
  const feeds = useInfiniteQuery({
    queryKey: [did, 'searchFeeds', query],
    enabled: !!query && tab === 'feeds',
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await agent.app.bsky.unspecced.getPopularFeedGenerators(
          { query, limit: 24, cursor: pageParam },
          { signal },
        )
      ).data,
    getNextPageParam: (page) => page.cursor,
  })
  const current = tab === 'posts' ? posts : tab === 'people' ? people : feeds
  return (
    <>
      <PageHeader title="見つける" eyebrow="A LITTLE EXPLORATION" />
      <div className="search-header">
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault()
            setParams(input.trim() ? { q: input.trim() } : {})
          }}
        >
          <SearchIcon size={19} />
          <input
            aria-label="Blueskyを検索"
            placeholder="投稿、人、フィードを検索"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="text-button">検索</button>
        </form>
      </div>
      <div className="feed-tabs" role="tablist" aria-label="検索対象">
        {[
          ['posts', '投稿'],
          ['people', 'ユーザー'],
          ['feeds', 'フィード'],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'posts' && query && (
        <div className="search-options">
          <label className="sr-only" htmlFor="search-sort">
            投稿の並び順
          </label>
          <select
            id="search-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="latest">新しい順</option>
            <option value="top">人気順</option>
          </select>
          <details>
            <summary>絞り込み</summary>
            <div className="form-grid">
              <label>
                言語
                <select value={lang} onChange={(e) => setLang(e.target.value)}>
                  <option value="">すべての言語</option>
                  <option value="ja">日本語</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label>
                投稿者
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="ハンドルまたはDID"
                />
              </label>
              <label>
                開始日
                <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
              </label>
              <label>
                終了日（この日より前）
                <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
              </label>
            </div>
          </details>
        </div>
      )}
      {!query ? (
        <Empty icon={<Compass size={38} />} title="好きなものを、もっと。">
          言葉やハッシュタグから、あなたの興味を探しましょう。
        </Empty>
      ) : current.isPending ? (
        <Spinner />
      ) : current.isError && !current.data ? (
        <ErrorState error={current.error} retry={() => void current.refetch()} />
      ) : (
        <>
          {tab === 'posts' &&
            posts.data?.pages
              .flatMap((p) => p.posts)
              .filter((p, i, a) => a.findIndex((x) => x.uri === p.uri) === i)
              .map((post) => <PostCard key={post.uri} post={post} />)}
          {tab === 'people' &&
            people.data?.pages
              .flatMap((p) => p.actors)
              .filter((p, i, a) => a.findIndex((x) => x.did === p.did) === i)
              .map((profile) => <ProfileCard key={profile.did} profile={profile} />)}
          {tab === 'feeds' && (
            <div className="page-body feed-grid">
              {feeds.data?.pages
                .flatMap((p) => p.feeds)
                .filter((p, i, a) => a.findIndex((x) => x.uri === p.uri) === i)
                .map((feed) => (
                  <FeedCard key={feed.uri} feed={feed} />
                ))}
            </div>
          )}
          {((tab === 'posts' && !posts.data?.pages[0].posts.length) ||
            (tab === 'people' && !people.data?.pages[0].actors.length) ||
            (tab === 'feeds' && !feeds.data?.pages[0].feeds.length)) && (
            <Empty title="見つかりませんでした">別のキーワードで探してみてください。</Empty>
          )}
          <LoadMore
            hasMore={current.hasNextPage}
            loading={current.isFetchingNextPage}
            load={() => void current.fetchNextPage()}
          />
          {current.isFetchNextPageError && (
            <ErrorState error={current.error} retry={() => void current.fetchNextPage()} />
          )}
        </>
      )}
    </>
  )
}
