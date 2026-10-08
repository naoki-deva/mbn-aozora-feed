import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { moderateProfile, type AppBskyActorDefs } from '@atproto/api'
import { Bell, Flag, ShieldOff, MessageCircle, VolumeX, Pencil } from 'lucide-react'
import { useApp, useModeration } from '../lib/context'
import { blockActor, deleteRecord, uploadImage } from '../lib/api'
import { safeUrl, profilePath } from '../lib/preferences'
import {
  Avatar,
  Confirm,
  Empty,
  ErrorState,
  LoadMore,
  Modal,
  PageHeader,
  Spinner,
  useAction,
} from '../components/ui'
import { PostCard } from '../components/PostCard'
import { ProfileCard } from '../components/ProfileCard'
import { Report } from '../components/Report'
import { ActorLists, ActorStarterPacks } from './Lists'
import { FeedCard } from './Feeds'
function EditProfile({
  profile,
  onClose,
}: {
  profile: AppBskyActorDefs.ProfileViewDetailed
  onClose: () => void
}) {
  const { agent } = useApp()
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [description, setDescription] = useState(profile.description ?? '')
  const [pronouns, setPronouns] = useState(profile.pronouns ?? '')
  const [website, setWebsite] = useState(profile.website ?? '')
  const [avatar, setAvatar] = useState<File>()
  const [banner, setBanner] = useState<File>()
  const [removeAvatar, setRemoveAvatar] = useState(false)
  const [removeBanner, setRemoveBanner] = useState(false)
  const [unpin, setUnpin] = useState(false)
  const save = useAction(
    async () => {
      if (website && !safeUrl(website))
        throw new Error('WebサイトにはHTTPまたはHTTPSのURLを入力してください。')
      const avatarBlob = avatar ? await uploadImage(agent, avatar) : undefined
      const bannerBlob = banner ? await uploadImage(agent, banner) : undefined
      await agent.upsertProfile((existing) => ({
        ...existing,
        displayName,
        description,
        pronouns,
        website: website || undefined,
        avatar: removeAvatar ? undefined : (avatarBlob ?? existing?.avatar),
        banner: removeBanner ? undefined : (bannerBlob ?? existing?.banner),
        pinnedPost: unpin ? undefined : existing?.pinnedPost,
      }))
    },
    'プロフィールを更新しました',
    onClose,
  )
  return (
    <Modal
      title="プロフィールを編集"
      onClose={() => {
        if (!save.isPending) onClose()
      }}
    >
      <form
        className="modal-body stack"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label>
          表示名
          <input
            data-autofocus
            maxLength={64}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label>
          自己紹介
          <textarea
            rows={4}
            maxLength={256}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          代名詞
          <input maxLength={20} value={pronouns} onChange={(e) => setPronouns(e.target.value)} />
        </label>
        <label>
          Webサイト
          <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            アイコン（1MB以下）
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                setAvatar(e.target.files?.[0])
                setRemoveAvatar(false)
              }}
            />
          </label>
          <label>
            カバー（1MB以下）
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                setBanner(e.target.files?.[0])
                setRemoveBanner(false)
              }}
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={removeAvatar}
            onChange={(e) => setRemoveAvatar(e.target.checked)}
          />
          アイコンを削除
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={removeBanner}
            onChange={(e) => setRemoveBanner(e.target.checked)}
          />
          カバーを削除
        </label>
        {profile.pinnedPost && (
          <label className="checkbox-label">
            <input type="checkbox" checked={unpin} onChange={(e) => setUnpin(e.target.checked)} />
            固定投稿を解除
          </label>
        )}
        <button className="button" disabled={save.isPending}>
          {save.isPending ? '保存中…' : '保存する'}
        </button>
      </form>
    </Modal>
  )
}
export function Connections() {
  const { actor = '', type = 'followers' } = useParams()
  const { agent, did } = useApp()
  const people = useInfiniteQuery({
    queryKey: [did, 'connections', actor, type],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (type === 'following') {
        const res = await agent.getFollows({ actor, limit: 40, cursor: pageParam }, { signal })
        return { people: res.data.follows, cursor: res.data.cursor }
      }
      const res = await agent.getFollowers({ actor, limit: 40, cursor: pageParam }, { signal })
      return { people: res.data.followers, cursor: res.data.cursor }
    },
    getNextPageParam: (page) => page.cursor,
  })
  return (
    <>
      <PageHeader title={type === 'following' ? 'フォロー中' : 'フォロワー'} back />
      {people.isPending ? (
        <Spinner />
      ) : people.isError && !people.data ? (
        <ErrorState error={people.error} retry={() => void people.refetch()} />
      ) : (
        <>
          {people.data?.pages
            .flatMap((p) => p.people)
            .map((p) => (
              <ProfileCard key={p.did} profile={p} />
            ))}
          {!people.data?.pages[0].people.length && <Empty title="まだ誰もいません" />}
          <LoadMore
            hasMore={people.hasNextPage}
            loading={people.isFetchingNextPage}
            load={() => void people.fetchNextPage()}
          />
          {people.isFetchNextPageError && (
            <ErrorState error={people.error} retry={() => void people.fetchNextPage()} />
          )}
        </>
      )}
    </>
  )
}
function ProfileFeeds({ actor }: { actor: string }) {
  const { agent, did } = useApp()
  const feeds = useInfiniteQuery({
    queryKey: [did, 'actorFeeds', actor],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (await agent.app.bsky.feed.getActorFeeds({ actor, cursor: pageParam, limit: 30 }, { signal }))
        .data,
    getNextPageParam: (page) => page.cursor,
  })
  return feeds.isPending ? (
    <Spinner />
  ) : feeds.isError && !feeds.data ? (
    <ErrorState error={feeds.error} />
  ) : (
    <>
      <div className="feed-grid page-body">
        {feeds.data?.pages
          .flatMap((p) => p.feeds)
          .map((f) => (
            <FeedCard key={f.uri} feed={f} />
          ))}
      </div>
      {!feeds.data?.pages[0].feeds.length && <Empty title="フィードはまだありません" />}
      <LoadMore
        hasMore={feeds.hasNextPage}
        loading={feeds.isFetchingNextPage}
        load={() => void feeds.fetchNextPage()}
      />
    </>
  )
}
export function Profile() {
  const { actor = '' } = useParams()
  const { agent, did, requireAuth } = useApp()
  const { opts, ready, error: moderationError } = useModeration()
  const navigate = useNavigate()
  const [tab, setTab] = useState<
    'posts' | 'replies' | 'media' | 'likes' | 'feeds' | 'lists' | 'packs'
  >('posts')
  const [editing, setEditing] = useState(false)
  const [report, setReport] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [reveal, setReveal] = useState(false)
  const profile = useQuery({
    queryKey: [did, 'profile', actor],
    queryFn: async ({ signal }) => (await agent.getProfile({ actor }, { signal })).data,
  })
  const feed = useInfiniteQuery({
    queryKey: [did, 'authorFeed', actor, tab],
    enabled: ['posts', 'replies', 'media', 'likes'].includes(tab),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      tab === 'likes'
        ? (await agent.getActorLikes({ actor, cursor: pageParam, limit: 30 }, { signal })).data
        : (
            await agent.getAuthorFeed(
              {
                actor,
                filter:
                  tab === 'media'
                    ? 'posts_with_media'
                    : tab === 'replies'
                      ? 'posts_with_replies'
                      : 'posts_no_replies',
                cursor: pageParam,
                limit: 30,
              },
              { signal },
            )
          ).data,
    getNextPageParam: (page) => page.cursor,
  })
  const action = useAction<'follow' | 'mute' | 'block' | 'chat' | 'subscribe'>(async (kind) => {
    const p = profile.data!
    if (kind === 'follow')
      return p.viewer?.following ? agent.deleteFollow(p.viewer.following) : agent.follow(p.did)
    if (kind === 'mute') return p.viewer?.muted ? agent.unmute(p.did) : agent.mute(p.did)
    if (kind === 'block') {
      if (p.viewer?.blocking) await deleteRecord(agent, p.viewer.blocking)
      else await blockActor(agent, p.did)
      setBlocking(false)
    }
    if (kind === 'subscribe')
      return agent.app.bsky.notification.putActivitySubscription({
        subject: p.did,
        activitySubscription: { post: !p.viewer?.activitySubscription?.post, reply: false },
      })
    if (kind === 'chat') {
      const res = await agent
        .withProxy('bsky_chat', 'did:web:api.bsky.chat')
        .chat.bsky.convo.getConvoForMembers({ members: [p.did] })
      navigate(`/messages/${res.data.convo.id}`)
    }
  })
  const run = (kind: 'follow' | 'mute' | 'chat' | 'subscribe') => {
    if (requireAuth()) action.mutate(kind)
  }
  if (profile.isPending || (!ready && !moderationError)) return <Spinner />
  if (profile.isError || moderationError)
    return (
      <ErrorState error={profile.error ?? moderationError} retry={() => void profile.refetch()} />
    )
  const p = profile.data!
  const mod = moderateProfile(p, opts)
  const ui = mod.ui('profileView')
  const own = p.did === did
  const hide = ui.noOverride || ui.filter || (ui.blur && !reveal)
  return (
    <>
      <PageHeader title={p.displayName || p.handle} back />
      <div className="profile-banner">
        {safeUrl(p.banner) && !hide && !mod.ui('banner').blur && (
          <img src={safeUrl(p.banner)} alt="" />
        )}
      </div>
      <div className="profile-info">
        <div className="profile-top">
          <Avatar
            src={p.avatar}
            name={p.displayName || p.handle}
            size={82}
            blurred={mod.ui('avatar').blur}
          />
          <div className="button-row">
            {own ? (
              <button className="button secondary small" onClick={() => setEditing(true)}>
                <Pencil size={14} />
                編集
              </button>
            ) : (
              <>
                <button
                  className={`icon-button ${p.viewer?.activitySubscription?.post ? 'selected' : ''}`}
                  aria-label="このユーザーの投稿通知を切り替える"
                  disabled={action.isPending || hide}
                  onClick={() => run('subscribe')}
                >
                  <Bell size={19} />
                </button>
                <button
                  className="icon-button"
                  aria-label="メッセージを送る"
                  disabled={action.isPending || hide}
                  onClick={() => run('chat')}
                >
                  <MessageCircle size={19} />
                </button>
                <button
                  className={`button small ${p.viewer?.following ? 'secondary' : ''}`}
                  disabled={action.isPending || hide}
                  onClick={() => run('follow')}
                >
                  {p.viewer?.following ? 'フォロー中' : 'フォロー'}
                </button>
              </>
            )}
          </div>
        </div>
        <h2 className={mod.ui('displayName').blur ? 'blurred' : ''}>
          {p.displayName || p.handle}
          {p.verification?.verifiedStatus === 'valid' && <span className="verified">✓</span>}
        </h2>
        <p className="handle">
          @{p.handle} {p.pronouns && `· ${p.pronouns}`}
        </p>
        {p.viewer?.followedBy && <span className="pill">フォローされています</span>}
        {hide ? (
          <div className="notice">
            このプロフィールは表示設定で非表示です。
            {!ui.noOverride && !ui.filter && (
              <button className="text-button" onClick={() => setReveal(true)}>
                表示する
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="profile-description">{p.description}</p>
            {safeUrl(p.website) && (
              <a className="small-link" href={safeUrl(p.website)} target="_blank" rel="noreferrer">
                {p.website}
              </a>
            )}
            <div className="profile-counts">
              <Link to={`${profilePath(p.did)}/following`}>
                <strong>{p.followsCount ?? 0}</strong> フォロー中
              </Link>
              <Link to={`${profilePath(p.did)}/followers`}>
                <strong>{p.followersCount ?? 0}</strong> フォロワー
              </Link>
              <span>
                <strong>{p.postsCount ?? 0}</strong> 投稿
              </span>
            </div>
          </>
        )}
        {!own && (
          <div className="profile-tools">
            <button className="text-button" disabled={action.isPending} onClick={() => run('mute')}>
              <VolumeX size={14} />
              {p.viewer?.muted ? 'ミュート解除' : 'ミュート'}
            </button>
            <button
              className="text-button"
              disabled={action.isPending}
              onClick={() => {
                if (requireAuth()) setBlocking(true)
              }}
            >
              <ShieldOff size={14} />
              {p.viewer?.blocking ? 'ブロック解除' : 'ブロック'}
            </button>
            <button
              className="text-button"
              onClick={() => {
                if (requireAuth()) setReport(true)
              }}
            >
              <Flag size={14} />
              報告
            </button>
          </div>
        )}
      </div>
      {!hide && (
        <>
          <div className="feed-tabs" role="tablist" aria-label="プロフィールのコンテンツ">
            {[
              ['posts', '投稿'],
              ['replies', '返信'],
              ['media', 'メディア'],
              ...(own ? [['likes', 'いいね']] : []),
              ['feeds', 'フィード'],
              ['lists', 'リスト'],
              ['packs', 'スターターパック'],
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
          {tab === 'lists' ? (
            <ActorLists actor={p.did} />
          ) : tab === 'packs' ? (
            <ActorStarterPacks actor={p.did} />
          ) : tab === 'feeds' ? (
            <ProfileFeeds actor={p.did} />
          ) : feed.isPending ? (
            <Spinner />
          ) : feed.isError && !feed.data ? (
            <ErrorState error={feed.error} retry={() => void feed.refetch()} />
          ) : (
            <>
              {feed.data?.pages
                .flatMap((page) => page.feed)
                .filter((item, i, a) => a.findIndex((x) => x.post.uri === item.post.uri) === i)
                .map((item) => (
                  <PostCard key={item.post.uri} post={item.post} reason={item.reason} />
                ))}
              {!feed.data?.pages[0].feed.length && <Empty title="投稿はまだありません" />}
              <LoadMore
                hasMore={feed.hasNextPage}
                loading={feed.isFetchingNextPage}
                load={() => void feed.fetchNextPage()}
              />
              {feed.isFetchNextPageError && (
                <ErrorState error={feed.error} retry={() => void feed.fetchNextPage()} />
              )}
            </>
          )}
        </>
      )}
      {editing && <EditProfile profile={p} onClose={() => setEditing(false)} />}
      {report && <Report subject={{ did: p.did }} onClose={() => setReport(false)} />}
      {blocking && (
        <Confirm
          title={
            p.viewer?.blocking ? 'ブロックを解除しますか？' : 'このユーザーをブロックしますか？'
          }
          destructive={!p.viewer?.blocking}
          onClose={() => setBlocking(false)}
          onConfirm={() => action.mutate('block')}
          pending={action.isPending}
        >
          {p.viewer?.blocking
            ? '再びお互いの投稿を見られるようになります。'
            : 'お互いの投稿・返信・メンションが見えなくなります。'}
        </Confirm>
      )}
    </>
  )
}
