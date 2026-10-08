import {
  AtpAgent,
  RichText,
  AppBskyFeedDefs,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  AppBskyEmbedVideo,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  ComAtprotoRepoApplyWrites,
  type AppBskyFeedThreadgate,
  type AppBskyGraphDefs,
  type AppBskyFeedDefs as FeedDefs,
  type BlobRef,
} from '@atproto/api'
import { TID } from '@atproto/common-web'
import { graphemeLength, safeUrl, type Preferences, type FeedSource } from './preferences'
export type Post = FeedDefs.PostView
export type FeedItem = FeedDefs.FeedViewPost
export function knownRecord(value: unknown): AppBskyFeedPost.Record | undefined {
  return AppBskyFeedPost.validateRecord(value).success
    ? (value as AppBskyFeedPost.Record)
    : undefined
}
export function getRecord(post: Post): AppBskyFeedPost.Record | undefined {
  return knownRecord(post.record)
}
export function hasMedia(post: Post): boolean {
  const e = post.embed
  return (
    AppBskyEmbedImages.isView(e) ||
    AppBskyEmbedVideo.isView(e) ||
    AppBskyEmbedRecordWithMedia.isView(e)
  )
}
export function visibleFeed(items: FeedItem[], prefs: Preferences): FeedItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.post.uri)) return false
    seen.add(item.post.uri)
    const record = getRecord(item.post)
    if (!prefs.showReplies && record?.reply) return false
    if (!prefs.showReposts && AppBskyFeedDefs.isReasonRepost(item.reason)) return false
    if (
      !prefs.showQuotes &&
      (AppBskyEmbedRecord.isView(item.post.embed) ||
        AppBskyEmbedRecordWithMedia.isView(item.post.embed))
    )
      return false
    if (prefs.mediaOnly && !hasMedia(item.post)) return false
    return true
  })
}
export async function fetchFeed(
  agent: AtpAgent,
  source: FeedSource,
  cursor?: string,
  signal?: AbortSignal,
) {
  if (source.kind === 'following')
    return (await agent.getTimeline({ limit: 30, cursor }, { signal })).data
  if (source.kind === 'list')
    return (
      await agent.app.bsky.feed.getListFeed({ list: source.uri!, limit: 30, cursor }, { signal })
    ).data
  return (await agent.app.bsky.feed.getFeed({ feed: source.uri!, limit: 30, cursor }, { signal }))
    .data
}
export type ImageAttachment = { file: File; alt: string }
export type PostDraft = {
  text: string
  images: ImageAttachment[]
  video?: File
  videoAlt?: string
  quote?: Post
  reply?: Post
  language: string
  adult: boolean
  replyRule: 'all' | 'none' | 'following' | 'followers' | 'mentioned'
  allowQuotes: boolean
  external?: { uri: string; title: string; description: string }
}
export async function uploadImage(agent: AtpAgent, file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('画像はJPEG・PNG・WebPを選択してください。')
  if (file.size > 1_000_000) throw new Error('画像は1枚1MB以下にしてください。')
  return (await agent.uploadBlob(file, { encoding: file.type })).data.blob
}
export async function uploadVideo(
  agent: AtpAgent,
  file: File,
  onProgress: (value: string) => void,
): Promise<BlobRef> {
  if (file.type !== 'video/mp4' || file.size > 100_000_000)
    throw new Error('動画は100MB以下のMP4を選択してください。')
  const { data } = await agent.com.atproto.server.getServiceAuth({
    aud: 'did:web:video.bsky.app',
    lxm: 'com.atproto.repo.uploadBlob',
    exp: Math.floor(Date.now() / 1000) + 60 * 30,
  })
  const url = new URL('https://video.bsky.app/xrpc/app.bsky.video.uploadVideo')
  url.searchParams.set('did', agent.session!.did)
  url.searchParams.set('name', `aozora-${Date.now()}.mp4`)
  onProgress('動画をアップロードしています…')
  const result = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'video/mp4' },
    body: file,
    signal: AbortSignal.timeout(120_000),
  })
  const body = await result.json()
  // VideoAlreadyExists can return a usable jobStatus with a 409.
  if (!result.ok && !body.jobStatus)
    throw new Error(body.message ?? '動画をアップロードできませんでした。')
  const videoAgent = new AtpAgent({ service: 'https://video.bsky.app' })
  let job = body.jobStatus
  if (!job || typeof job.jobId !== 'string')
    throw new Error('動画サービスから処理IDを取得できませんでした。')
  const deadline = Date.now() + 10 * 60 * 1000
  while (!job.blob) {
    if (job.state === 'JOB_STATE_FAILED')
      throw new Error(job.message ?? '動画の処理に失敗しました。')
    if (Date.now() > deadline)
      throw new Error('動画処理がタイムアウトしました。時間をおいて再試行してください。')
    onProgress(`動画を処理しています… ${job.progress ?? 0}%`)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    job = (await videoAgent.app.bsky.video.getJobStatus({ jobId: job.jobId })).data.jobStatus
  }
  return job.blob
}
export async function publishPost(
  agent: AtpAgent,
  draft: PostDraft,
  onProgress: (value: string) => void,
) {
  if (!agent.session) throw new Error('ログインしてください。')
  if (!draft.text.trim() && !draft.images.length && !draft.video)
    throw new Error('投稿内容を入力してください。')
  if (graphemeLength(draft.text) > 300) throw new Error('投稿は300文字以内にしてください。')
  if (draft.images.length > 4 || (draft.video && draft.images.length))
    throw new Error('画像は4枚まで、動画とは同時に添付できません。')
  const rich = new RichText({ text: draft.text })
  await rich.detectFacets(agent)
  let embed: AppBskyFeedPost.Record['embed']
  if (draft.images.length) {
    onProgress('画像をアップロードしています…')
    const images = await Promise.all(
      draft.images.map(async (image) => ({
        image: await uploadImage(agent, image.file),
        alt: image.alt,
      })),
    )
    embed = { $type: 'app.bsky.embed.images', images }
  } else if (draft.video) {
    embed = {
      $type: 'app.bsky.embed.video',
      video: await uploadVideo(agent, draft.video, onProgress),
      alt: draft.videoAlt,
    }
  } else if (draft.external) {
    const uri = safeUrl(draft.external.uri)
    if (!uri) throw new Error('リンクはHTTPまたはHTTPSのURLを指定してください。')
    embed = { $type: 'app.bsky.embed.external', external: { ...draft.external, uri } }
  }
  if (draft.quote) {
    if (draft.quote.viewer?.embeddingDisabled)
      throw new Error('この投稿の引用は許可されていません。')
    const record: AppBskyEmbedRecord.Main & { $type: 'app.bsky.embed.record' } = {
      $type: 'app.bsky.embed.record',
      record: { uri: draft.quote.uri, cid: draft.quote.cid },
    }
    embed = embed ? { $type: 'app.bsky.embed.recordWithMedia', record, media: embed } : record
  }
  const rkey = TID.nextStr()
  const uri = `at://${agent.session.did}/app.bsky.feed.post/${rkey}`
  const createdAt = new Date().toISOString()
  const parent = draft.reply ? { uri: draft.reply.uri, cid: draft.reply.cid } : undefined
  const post: AppBskyFeedPost.Record = {
    $type: 'app.bsky.feed.post',
    text: rich.text,
    facets: rich.facets,
    createdAt,
    langs: [draft.language],
    embed,
    reply: parent ? { parent, root: getRecord(draft.reply!)?.reply?.root ?? parent } : undefined,
    labels: draft.adult
      ? { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'sexual' }] }
      : undefined,
  }
  const writes: ComAtprotoRepoApplyWrites.InputSchema['writes'] = [
    {
      $type: 'com.atproto.repo.applyWrites#create',
      collection: 'app.bsky.feed.post',
      rkey,
      value: post,
    },
  ]
  if (draft.replyRule !== 'all') {
    const allow: AppBskyFeedThreadgate.Record['allow'] =
      draft.replyRule === 'none'
        ? []
        : [
            {
              $type: `app.bsky.feed.threadgate#${({ following: 'following', followers: 'follower', mentioned: 'mention' } as const)[draft.replyRule]}Rule`,
            },
          ]
    writes.push({
      $type: 'com.atproto.repo.applyWrites#create',
      collection: 'app.bsky.feed.threadgate',
      rkey,
      value: { $type: 'app.bsky.feed.threadgate', post: uri, createdAt, allow },
    })
  }
  if (!draft.allowQuotes)
    writes.push({
      $type: 'com.atproto.repo.applyWrites#create',
      collection: 'app.bsky.feed.postgate',
      rkey,
      value: {
        $type: 'app.bsky.feed.postgate',
        post: uri,
        createdAt,
        embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
      },
    })
  onProgress('投稿しています…')
  const result = await agent.com.atproto.repo.applyWrites({
    repo: agent.session.did,
    validate: true,
    writes,
  })
  const first = result.data.results?.[0]
  if (!ComAtprotoRepoApplyWrites.isCreateResult(first))
    throw new Error('投稿結果を確認できませんでした。プロフィールを確認してください。')
  return { uri: first.uri, cid: first.cid }
}
export async function blockActor(agent: AtpAgent, did: string) {
  return agent.app.bsky.graph.block.create(
    { repo: agent.session!.did },
    { subject: did, createdAt: new Date().toISOString() },
  )
}
export async function deleteRecord(agent: AtpAgent, uri: string) {
  const parsed = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri)
  if (!parsed || parsed[1] !== agent.session?.did)
    throw new Error('自分のレコードだけを削除できます。')
  const [, repo, collection, rkey] = parsed
  return agent.com.atproto.repo.deleteRecord({ repo, collection, rkey })
}
export async function createList(
  agent: AtpAgent,
  name: string,
  description: string,
  purpose: 'curation' | 'moderation',
) {
  const rich = new RichText({ text: description })
  await rich.detectFacets(agent)
  return (
    await agent.app.bsky.graph.list.create(
      { repo: agent.session!.did },
      {
        name,
        description: rich.text,
        descriptionFacets: rich.facets,
        purpose:
          purpose === 'curation' ? 'app.bsky.graph.defs#curatelist' : 'app.bsky.graph.defs#modlist',
        createdAt: new Date().toISOString(),
      },
    )
  ).uri
}
export function listSource(
  list: AppBskyGraphDefs.ListView | AppBskyGraphDefs.ListViewBasic,
): FeedSource {
  return { id: list.uri, uri: list.uri, kind: 'list', name: list.name }
}
export function generatorSource(feed: FeedDefs.GeneratorView): FeedSource {
  return {
    id: feed.uri,
    uri: feed.uri,
    kind: 'feed',
    name: feed.displayName,
    description: feed.description,
  }
}
export function bskyPostUrl(post: Post): string {
  return `https://bsky.app/profile/${post.author.did}/post/${post.uri.split('/').at(-1)}`
}
