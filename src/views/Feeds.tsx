import { readAccountPreferences } from '../lib/remote-preferences'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { type AppBskyFeedDefs, moderateFeedGenerator } from '@atproto/api'
import {
  Search,
  Plus,
  Check,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  Radio,
  CloudSun,
  Sparkles,
  Trash2,
  Download,
  Upload,
  Star,
  Rss,
} from 'lucide-react'
import { useApp, useRemotePreferences, useModeration } from '../lib/context'
import { following, feedPath, type FeedSource } from '../lib/preferences'
import { generatorSource } from '../lib/api'
import {
  Avatar,
  Empty,
  ErrorState,
  LoadMore,
  PageHeader,
  Spinner,
  useAction,
} from '../components/ui'
export function FeedCard({
  feed,
  selected,
  toggle,
}: {
  feed: AppBskyFeedDefs.GeneratorView
  selected?: boolean
  toggle?: () => void
}) {
  const { prefs, addFeed } = useApp()
  const { opts, ready } = useModeration()
  const ui = moderateFeedGenerator(feed, opts).ui('contentList')
  if (!ready || ui.filter || ui.blur || ui.noOverride) return null
  const added = selected ?? prefs.feeds.some((f) => f.id === feed.uri)
  return (
    <div className={`feed-card ${added ? 'selected' : ''}`}>
      <div className="feed-card-top">
        <Avatar src={feed.avatar} name={feed.displayName} size={44} />
        <button
          className={`icon-button add-feed ${added ? 'checked' : ''}`}
          aria-label={added ? `${feed.displayName}を選択解除` : `${feed.displayName}を追加`}
          aria-pressed={added}
          disabled={!toggle && added}
          onClick={toggle ?? (() => addFeed(generatorSource(feed)))}
        >
          {added ? <Check size={19} /> : <Plus size={19} />}
        </button>
      </div>
      <Link to={feedPath(feed.uri)} className="feed-card-name">
        {feed.displayName}
      </Link>
      <p>{feed.description || 'このフィードを開いて、新しい投稿を見つけよう。'}</p>
      <div className="feed-card-bottom">
        <span>by @{feed.creator.handle}</span>
        <span>
          {feed.likeCount ? (
            `${new Intl.NumberFormat('ja', { notation: 'compact' }).format(feed.likeCount)} ♡`
          ) : (
            <Radio size={13} />
          )}
        </span>
      </div>
    </div>
  )
}
export function FeedDiscovery({
  selection,
  setSelection,
}: {
  selection?: FeedSource[]
  setSelection?: (feeds: FeedSource[]) => void
}) {
  const { agent, did } = useApp()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const feeds = useInfiniteQuery({
    queryKey: [did, 'discoverFeeds', query],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await agent.app.bsky.unspecced.getPopularFeedGenerators(
          { limit: 12, cursor: pageParam, query: query || undefined },
          { signal },
        )
      ).data,
    getNextPageParam: (page) => page.cursor,
  })
  return (
    <>
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault()
          setQuery(input.trim())
        }}
      >
        <Search size={19} />
        <input
          aria-label="フィードを検索"
          placeholder="興味のあることから、フィードを探す"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="text-button" type="submit">
          検索
        </button>
      </form>
      {feeds.isPending ? (
        <Spinner />
      ) : feeds.isError && !feeds.data ? (
        <ErrorState error={feeds.error} retry={() => void feeds.refetch()} />
      ) : (
        <>
          <div className="feed-grid">
            {feeds.data.pages
              .flatMap((p) => p.feeds)
              .filter((f, i, all) => all.findIndex((x) => x.uri === f.uri) === i)
              .map((feed) => (
                <FeedCard
                  key={feed.uri}
                  feed={feed}
                  selected={selection?.some((f) => f.id === feed.uri)}
                  toggle={
                    setSelection && selection
                      ? () =>
                          setSelection(
                            selection.some((f) => f.id === feed.uri)
                              ? selection.filter((f) => f.id !== feed.uri)
                              : [...selection, generatorSource(feed)],
                          )
                      : undefined
                  }
                />
              ))}
          </div>
          {!feeds.data.pages[0].feeds.length && (
            <Empty title="フィードが見つかりませんでした">
              別のキーワードで探してみてください。
            </Empty>
          )}
          <LoadMore
            hasMore={feeds.hasNextPage}
            loading={feeds.isFetchingNextPage}
            load={() => void feeds.fetchNextPage()}
          />
          {feeds.isFetchNextPageError && (
            <ErrorState error={feeds.error} retry={() => void feeds.fetchNextPage()} />
          )}
        </>
      )}
    </>
  )
}
export function Onboarding() {
  const { did, openLogin, prefs, updatePrefs } = useApp()
  const [selection, setSelection] = useState<FeedSource[]>(prefs.feeds)
  const navigate = useNavigate()
  return (
    <div className="onboarding">
      <div className="welcome-hero">
        <div className="hero-art" aria-hidden="true">
          <span className="sun" />
          <CloudSun size={110} strokeWidth={1.2} />
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <span className="hero-spark">✧</span>
        </div>
        <span className="eyebrow">WELCOME TO YOUR SKY</span>
        <h1>
          自分の空を、
          <br />
          自分で選ぶ。
        </h1>
        <p>
          見たいものから、はじめよう。
          <br />
          あなたのホームに、決まったフィードはありません。
        </p>
        <div className="hero-chips">
          <span>
            <SlidersHorizontal size={13} />
            フィードを自由に
          </span>
          <span>
            <Sparkles size={13} />
            表示も自分らしく
          </span>
        </div>
      </div>
      <div className="onboarding-body">
        <div className="section-heading">
          <div>
            <span className="eyebrow">01 / CHOOSE YOUR FEEDS</span>
            <h2>どんな空が見たい？</h2>
          </div>
          <span className="count-pill">{selection.length}個選択</span>
        </div>
        <p className="muted intro-copy">
          気になるフィードを選んでください。選択や並び順は、いつでも変更できます。
        </p>
        {did ? (
          <button
            className={`following-card ${selection.some((f) => f.id === 'following') ? 'selected' : ''}`}
            onClick={() =>
              setSelection(
                selection.some((f) => f.id === 'following')
                  ? selection.filter((f) => f.id !== 'following')
                  : [...selection, following],
              )
            }
          >
            <span className="following-icon">
              <Rss size={20} />
            </span>
            <span>
              <strong>フォロー中</strong>
              <small>フォローした人の投稿を時系列で</small>
            </span>
            {selection.some((f) => f.id === 'following') ? <Check size={19} /> : <Plus size={19} />}
          </button>
        ) : (
          <div className="login-invitation">
            <span>フォロー中のフィードも使いたい？</span>
            <button className="text-button" onClick={openLogin}>
              ログイン <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        <FeedDiscovery selection={selection} setSelection={setSelection} />
        <div className="onboarding-footer">
          <div>
            <strong>選んだものだけ、あなたのホームに。</strong>
            <small>おすすめフィードが勝手に追加されることはありません。</small>
          </div>
          <button
            className="button"
            disabled={!selection.length}
            onClick={() => {
              updatePrefs({
                feeds: selection,
                selectedFeed: selection[0].id,
                homeFeed: selection[0].id,
                onboarded: true,
              })
              navigate('/')
            }}
          >
            この空ではじめる <ArrowUpRight size={17} />
          </button>
        </div>
      </div>
    </div>
  )
}
function RemoteSync() {
  const { agent, did, prefs, updatePrefs, toast } = useApp()
  const remote = useRemotePreferences()
  const save = useAction(async () => {
    const current = await readAccountPreferences(agent)
    const ours = prefs.feeds.map((f) => ({
      id:
        current.savedFeeds.find((x) => x.value === (f.uri ?? 'following'))?.id ??
        crypto.randomUUID(),
      type: f.kind === 'following' ? ('timeline' as const) : f.kind,
      value: f.uri ?? 'following',
      pinned: true,
    }))
    // Preserve unpinned feeds stored by other clients.
    const others = current.savedFeeds.filter(
      (f) => !f.pinned && !ours.some((x) => x.value === f.value),
    )
    return agent.overwriteSavedFeeds([...ours, ...others])
  }, 'Blueskyにフィード設定を保存しました')
  const importFeeds = useAction(async () => {
    const current = await readAccountPreferences(agent)
    const selected = current.savedFeeds.filter((f) => f.pinned)
    const generators = selected.filter((f) => f.type === 'feed').map((f) => f.value)
    const found = new Map<string, FeedSource>()
    for (let start = 0; start < generators.length; start += 25) {
      const result = await agent.app.bsky.feed.getFeedGenerators({
        feeds: generators.slice(start, start + 25),
      })
      result.data.feeds.forEach((f) => found.set(f.uri, generatorSource(f)))
    }
    const lists = await Promise.all(
      selected
        .filter((f) => f.type === 'list')
        .map(async (f) => {
          const result = await agent.app.bsky.graph.getList({ list: f.value, limit: 1 })
          return { id: f.value, uri: f.value, name: result.data.list.name, kind: 'list' as const }
        }),
    )
    lists.forEach((f) => found.set(f.id, f))
    const imported = selected
      .map((f) => (f.type === 'timeline' ? following : found.get(f.value)))
      .filter((f): f is FeedSource => !!f)
    const feeds = [
      ...prefs.feeds,
      ...imported.filter((f) => !prefs.feeds.some((x) => x.id === f.id)),
    ]
    updatePrefs({ feeds, selectedFeed: prefs.selectedFeed ?? feeds[0]?.id ?? null })
    if (!imported.length) toast('Blueskyに固定されたフィードはありません')
  }, 'フィードを読み込みました')
  if (!did) return null
  return (
    <div className="sync-panel">
      <div>
        <strong>Blueskyとフィードを共有</strong>
        <small>
          読み込みは現在の選択に追加します。保存はBluesky側の固定フィードの順序を更新します。
        </small>
        {remote.isError && (
          <span className="danger-text text-small">設定を読み込めませんでした。</span>
        )}
      </div>
      <div className="button-row">
        <button
          className="button secondary small"
          disabled={importFeeds.isPending || save.isPending}
          onClick={() => importFeeds.mutate()}
        >
          <Download size={15} />
          読み込む
        </button>
        <button
          className="button secondary small"
          disabled={save.isPending || importFeeds.isPending}
          onClick={() => save.mutate()}
        >
          <Upload size={15} />
          保存する
        </button>
      </div>
    </div>
  )
}
export function Feeds() {
  const { agent, did, prefs, updatePrefs, addFeed, requireAuth } = useApp()
  const [uri, setUri] = useState('')
  const resolve = useAction(async () => {
    const { data } = await agent.app.bsky.feed.getFeedGenerator({ feed: uri.trim() })
    addFeed(generatorSource(data.view))
    setUri('')
  })
  return (
    <>
      <PageHeader title="フィードを選ぶ" eyebrow="MAKE IT YOURS" />
      <div className="page-body">
        <div className="section-heading">
          <h2>あなたのホーム</h2>
          <span className="count-pill">{prefs.feeds.length}フィード</span>
        </div>
        <p className="muted">追加・並べ替え・初期表示を、自由に。</p>
        {prefs.feeds.length ? (
          <div className="feed-order">
            {prefs.feeds.map((feed, i) => (
              <div className="feed-order-row" key={feed.id}>
                <span className="order-number">{String(i + 1).padStart(2, '0')}</span>
                <Link to={feed.kind === 'following' ? '/' : feedPath(feed.uri!)}>{feed.name}</Link>
                <button
                  className={`icon-button ${prefs.homeFeed === feed.id ? 'selected' : ''}`}
                  title="起動時のフィードに設定"
                  aria-label={`${feed.name}を起動時のフィードに設定`}
                  aria-pressed={prefs.homeFeed === feed.id}
                  onClick={() => updatePrefs({ homeFeed: feed.id })}
                >
                  <Star size={16} fill={prefs.homeFeed === feed.id ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`${feed.name}を上に移動`}
                  disabled={i === 0}
                  onClick={() => {
                    const feeds = [...prefs.feeds]
                    ;[feeds[i - 1], feeds[i]] = [feeds[i], feeds[i - 1]]
                    updatePrefs({ feeds })
                  }}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`${feed.name}を下に移動`}
                  disabled={i === prefs.feeds.length - 1}
                  onClick={() => {
                    const feeds = [...prefs.feeds]
                    ;[feeds[i + 1], feeds[i]] = [feeds[i], feeds[i + 1]]
                    updatePrefs({ feeds })
                  }}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`${feed.name}をホームから削除`}
                  onClick={() =>
                    updatePrefs({ feeds: prefs.feeds.filter((f) => f.id !== feed.id) })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="ホームはまだ白紙です">下から気になるフィードを追加しましょう。</Empty>
        )}
        {!prefs.feeds.some((f) => f.id === 'following') && (
          <button
            className="button secondary small"
            onClick={() => {
              if (requireAuth()) addFeed(following)
            }}
          >
            <Plus size={16} />
            フォロー中を追加
          </button>
        )}
        <RemoteSync />
        <div className="section-heading spaced">
          <div>
            <span className="eyebrow">EXPLORE THE SKY</span>
            <h2>新しいフィードを見つける</h2>
          </div>
        </div>
        <FeedDiscovery />
        <details className="custom-feed">
          <summary>AT URIでフィードを追加</summary>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              resolve.mutate()
            }}
          >
            <input
              aria-label="フィードのAT URI"
              placeholder="at://did:plc:…/app.bsky.feed.generator/…"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              required
            />
            <button className="button small" disabled={resolve.isPending}>
              追加
            </button>
          </form>
        </details>
        {!did && (
          <p className="muted text-small">ログイン前の選択は、このブラウザに保存されます。</p>
        )}
      </div>
    </>
  )
}
