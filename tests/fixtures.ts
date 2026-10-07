import type { Page } from '@playwright/test'
export const did = 'did:plc:abcdefghijklmnopqrstuvwx'
export const otherDid = 'did:plc:zyxwvutsrqponmlkjihgfedcb'
export const cid = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
export const artUri = `at://${did}/app.bsky.feed.generator/art`
export const techUri = `at://${did}/app.bsky.feed.generator/tech`
const now = new Date().toISOString()
export const person = {
  did,
  handle: 'me.bsky.social',
  displayName: '空の旅人',
  followersCount: 2,
  followsCount: 3,
  postsCount: 2,
  associated: { chat: { allowIncoming: 'all' } },
}
export const creator = { did: otherDid, handle: 'artist.bsky.social', displayName: 'あおい' }
export const feeds = [
  {
    uri: artUri,
    cid,
    did,
    creator,
    displayName: 'アートの空',
    description: '絵、写真、デザイン。好きな表現が見つかるフィード。',
    likeCount: 1200,
    indexedAt: now,
  },
  {
    uri: techUri,
    cid,
    did,
    creator,
    displayName: 'テクノロジー',
    description: 'つくる人の視点から、技術と開発のいまを知ろう。',
    likeCount: 840,
    indexedAt: now,
  },
]
export function post(text: string, id = 'test') {
  return {
    uri: `at://${otherDid}/app.bsky.feed.post/${id}`,
    cid,
    author: creator,
    record: { $type: 'app.bsky.feed.post', text, createdAt: now, langs: ['ja'] },
    indexedAt: now,
    likeCount: 3,
    replyCount: 1,
    repostCount: 0,
    quoteCount: 0,
    viewer: {},
  }
}
export function tokens() {
  const payload = Buffer.from(
    JSON.stringify({
      sub: did,
      exp: Math.floor(Date.now() / 1000) + 86400,
      scope: 'com.atproto.appPassPrivileged',
    }),
  ).toString('base64url')
  return {
    accessJwt: `eyJhbGciOiJub25lIn0.${payload}.test`,
    refreshJwt: `eyJhbGciOiJub25lIn0.${payload}.test`,
  }
}
export async function mockApi(page: Page) {
  const writes: { endpoint: string; body: Record<string, unknown> }[] = []
  const requests: string[] = []
  const posted = new Map<string, ReturnType<typeof post>>()
  let failFeed = false
  await page.route('**/xrpc/**', async (route) => {
    const url = new URL(route.request().url())
    const endpoint = url.pathname.split('/xrpc/')[1]
    requests.push(endpoint)
    const body = route.request().method() === 'POST' ? (route.request().postDataJSON() ?? {}) : {}
    if (route.request().method() === 'POST') writes.push({ endpoint, body })
    const reply = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    switch (endpoint) {
      case 'app.bsky.unspecced.getPopularFeedGenerators':
        return reply({ feeds, cursor: undefined })
      case 'app.bsky.feed.getFeedGenerator':
        return reply({
          view: feeds.find((f) => f.uri === url.searchParams.get('feed')) ?? feeds[0],
          isOnline: true,
          isValid: true,
        })
      case 'app.bsky.feed.getFeed':
        if (failFeed)
          return reply({ error: 'InternalServerError', message: 'Feed unavailable' }, 500)
        return reply({
          feed: [
            {
              post: post(
                url.searchParams.get('feed') === techUri
                  ? 'コードから生まれる、新しい景色。'
                  : '今日の空は、少しだけアート。',
              ),
            },
          ],
        })
      case 'app.bsky.feed.getTimeline':
        return reply({ feed: [{ post: post('フォロー中の投稿です。') }] })
      case 'app.bsky.feed.searchPosts':
        return reply({ posts: [post('検索で見つけた青い空。', 'search')], hitsTotal: 1 })
      case 'app.bsky.actor.searchActors':
        return reply({ actors: [creator] })
      case 'app.bsky.actor.getProfile':
        return reply(person)
      case 'app.bsky.actor.getPreferences':
        return reply({ preferences: [] })
      case 'app.bsky.labeler.getServices':
        return reply({ views: [] })
      case 'app.bsky.notification.getUnreadCount':
        return reply({ count: 2 })
      case 'app.bsky.notification.listNotifications':
        return reply({
          notifications: [
            {
              uri: `at://${otherDid}/app.bsky.feed.like/notice`,
              cid,
              author: creator,
              reason: 'like',
              reasonSubject: post('x').uri,
              record: {
                $type: 'app.bsky.feed.like',
                subject: { uri: post('x').uri, cid },
                createdAt: now,
              },
              isRead: false,
              indexedAt: now,
            },
          ],
          seenAt: now,
        })
      case 'com.atproto.server.createSession':
        return reply({ ...tokens(), did, handle: person.handle, active: true })
      case 'com.atproto.server.getSession':
        return reply({ did, handle: person.handle, active: true })
      case 'com.atproto.server.refreshSession':
        return reply({ ...tokens(), did, handle: person.handle, active: true })
      case 'com.atproto.server.deleteSession':
        return reply({})
      case 'com.atproto.repo.applyWrites': {
        const items = body.writes as {
          collection: string
          rkey: string
          value: Record<string, unknown>
        }[]
        const results = items.map((w) => {
          const uri = `at://${did}/${w.collection}/${w.rkey}`
          if (w.collection === 'app.bsky.feed.post')
            posted.set(uri, {
              ...post(String(w.value.text), w.rkey),
              uri,
              author: person,
              record: w.value as ReturnType<typeof post>['record'],
            })
          return { $type: 'com.atproto.repo.applyWrites#createResult', uri, cid }
        })
        return reply({ results })
      }
      case 'app.bsky.feed.getPostThread': {
        const uri = url.searchParams.get('uri')!
        return reply({
          thread: {
            $type: 'app.bsky.feed.defs#threadViewPost',
            post: posted.get(uri) ?? post('スレッドの投稿です。'),
            replies: [],
          },
        })
      }
      case 'app.bsky.feed.getAuthorFeed':
        return reply({ feed: [{ post: post('プロフィールの投稿です。') }] })
      case 'app.bsky.bookmark.getBookmarks':
        return reply({ bookmarks: [] })
      case 'app.bsky.graph.getLists':
        return reply({ lists: [] })
      case 'app.bsky.graph.getActorStarterPacks':
        return reply({ starterPacks: [] })
      case 'chat.bsky.convo.listConvos':
        return reply({ convos: [] })
      default:
        return reply({ error: 'UnexpectedEndpoint', message: endpoint }, 400)
    }
  })
  // Block remote assets so every browser test is independent of external services.
  await page.route(/^https:\/\/(?!.*\/xrpc\/)/, (route) => route.abort())
  return {
    writes,
    requests,
    setFeedFailure: (enabled: boolean) => {
      failFeed = enabled
    },
  }
}
export async function login(page: Page) {
  await page
    .getByRole('button', { name: /^ログイン$/ })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: 'ログイン' })
  await dialog.getByLabel('ハンドル', { exact: true }).fill('me.bsky.social')
  await dialog.getByLabel('アプリパスワード', { exact: true }).fill('test-test-test-test')
  await dialog.getByRole('button', { name: 'ログイン', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}
