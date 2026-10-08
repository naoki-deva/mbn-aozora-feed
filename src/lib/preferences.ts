export type FeedSource = {
  id: string
  name: string
  kind: 'following' | 'feed' | 'list'
  uri?: string
  description?: string
}
export type Preferences = {
  feeds: FeedSource[]
  homeFeed: string | null
  selectedFeed: string | null
  onboarded: boolean
  showReplies: boolean
  showReposts: boolean
  showQuotes: boolean
  mediaOnly: boolean
  compact: boolean
  hideCounts: boolean
  theme: 'system' | 'light' | 'dark'
  language: string
}
export const defaults: Preferences = {
  feeds: [],
  homeFeed: null,
  selectedFeed: null,
  onboarded: false,
  showReplies: true,
  showReposts: true,
  showQuotes: true,
  mediaOnly: false,
  compact: false,
  hideCounts: false,
  theme: 'system',
  language: 'ja',
}
export const following: FeedSource = {
  id: 'following',
  name: 'フォロー中',
  kind: 'following',
  description: 'フォローした人の投稿を時系列で',
}
export function validateFeed(value: unknown): value is FeedSource {
  if (!value || typeof value !== 'object') return false
  const f = value as Partial<FeedSource>
  if (typeof f.id !== 'string' || typeof f.name !== 'string') return false
  if (f.kind === 'following') return f.id === 'following'
  if (f.kind !== 'feed' && f.kind !== 'list') return false
  return (
    typeof f.uri === 'string' &&
    /^at:\/\/did:[^/]+\/app\.bsky\.(feed\.generator|graph\.list)\/[^/]+$/.test(f.uri) &&
    f.uri.includes(f.kind === 'feed' ? '/app.bsky.feed.generator/' : '/app.bsky.graph.list/') &&
    f.id === f.uri
  )
}
export function readPreferences(identity = 'guest'): Preferences {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`aozora:prefs:${identity}`) || '{}',
    ) as Partial<Preferences>
    const feeds = Array.isArray(saved.feeds)
      ? saved.feeds
          .filter(validateFeed)
          .filter((f, i, a) => a.findIndex((x) => x.id === f.id) === i)
      : []
    const result = { ...defaults, feeds }
    for (const key of [
      'onboarded',
      'showReplies',
      'showReposts',
      'showQuotes',
      'mediaOnly',
      'compact',
      'hideCounts',
    ] as const) {
      if (typeof saved[key] === 'boolean') result[key] = saved[key]
    }
    if (['system', 'light', 'dark'].includes(saved.theme ?? '')) result.theme = saved.theme!
    if (typeof saved.language === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(saved.language))
      result.language = saved.language
    result.homeFeed = feeds.some((f) => f.id === saved.homeFeed) ? saved.homeFeed! : null
    result.selectedFeed = feeds.some((f) => f.id === saved.selectedFeed)
      ? saved.selectedFeed!
      : (result.homeFeed ?? feeds[0]?.id ?? null)
    return result
  } catch {
    return { ...defaults, feeds: [] }
  }
}
export function normalizePreferences(prefs: Preferences): Preferences {
  const feeds = prefs.feeds
    .filter(validateFeed)
    .filter((f, i, a) => a.findIndex((x) => x.id === f.id) === i)
  return {
    ...prefs,
    feeds,
    homeFeed: feeds.some((f) => f.id === prefs.homeFeed) ? prefs.homeFeed : null,
    selectedFeed: feeds.some((f) => f.id === prefs.selectedFeed)
      ? prefs.selectedFeed
      : (feeds[0]?.id ?? null),
  }
}
export function writePreferences(identity: string, prefs: Preferences) {
  localStorage.setItem(`aozora:prefs:${identity}`, JSON.stringify(normalizePreferences(prefs)))
}
export function feedPath(uri: string): string {
  return `/feed/${encodeURIComponent(uri)}`
}
export function profilePath(actor: string): string {
  return `/profile/${encodeURIComponent(actor)}`
}
export function threadPath(uri: string): string {
  return `/post/${encodeURIComponent(uri)}`
}
export function listPath(uri: string): string {
  return `/list/${encodeURIComponent(uri)}`
}
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/AuthenticationRequired|ExpiredToken|InvalidToken|session/i.test(message))
    return 'セッションが失効しています。もう一度ログインしてください。'
  if (/InvalidIdentifier|InvalidPassword|AuthenticationFactorRequired/i.test(message))
    return 'ハンドルまたはアプリパスワードを確認してください。'
  if (/rate.limit|TooManyRequests/i.test(message))
    return 'リクエストが多すぎます。少し時間をおいて再試行してください。'
  if (/fetch|network|Failed to/i.test(message))
    return '通信できませんでした。接続を確認して再試行してください。'
  return message || '操作を完了できませんでした。もう一度お試しください。'
}
export function graphemeLength(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length
}

export function startupPreferences(identity = 'guest'): Preferences {
  const prefs = readPreferences(identity)
  return { ...prefs, selectedFeed: prefs.homeFeed ?? prefs.selectedFeed }
}
