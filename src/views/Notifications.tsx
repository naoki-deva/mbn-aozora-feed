import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { moderateNotification } from '@atproto/api'
import { Bell, Heart, Repeat2, UserPlus, MessageCircle, Quote, CheckCheck } from 'lucide-react'
import { useApp, useModeration } from '../lib/context'
import { knownRecord } from '../lib/api'
import { profilePath, threadPath } from '../lib/preferences'
import {
  Avatar,
  Empty,
  ErrorState,
  LoadMore,
  PageHeader,
  Spinner,
  useAction,
} from '../components/ui'
export function Notifications() {
  const { agent, did, openLogin } = useApp()
  const { opts, ready, error } = useModeration()
  const [onlyMentions, setOnlyMentions] = useState(false)
  const notices = useInfiniteQuery({
    queryKey: [did, 'notifications'],
    enabled: !!did,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (await agent.listNotifications({ limit: 40, cursor: pageParam }, { signal })).data,
    getNextPageParam: (page) => page.cursor,
  })
  const markRead = useAction(
    async () => agent.updateSeenNotifications(new Date().toISOString()),
    '通知を既読にしました',
  )
  const items =
    notices.data?.pages
      .flatMap((p) => p.notifications)
      .filter((n, i, a) => a.findIndex((x) => x.uri === n.uri && x.reason === n.reason) === i)
      .filter(
        (n) =>
          (!onlyMentions || ['mention', 'reply', 'quote'].includes(n.reason)) &&
          !moderateNotification(n, opts).ui('contentList').filter,
      ) ?? []
  return (
    <>
      <PageHeader
        title="通知"
        eyebrow="STAY CONNECTED"
        actions={
          did && (
            <button
              className="icon-button"
              aria-label="すべて既読にする"
              disabled={markRead.isPending || !notices.data}
              onClick={() => markRead.mutate()}
            >
              <CheckCheck size={20} />
            </button>
          )
        }
      />
      <div className="feed-tabs" role="tablist" aria-label="通知の種類">
        <button role="tab" aria-selected={!onlyMentions} onClick={() => setOnlyMentions(false)}>
          すべて
        </button>
        <button role="tab" aria-selected={onlyMentions} onClick={() => setOnlyMentions(true)}>
          メンション・返信
        </button>
      </div>
      {!did ? (
        <Empty icon={<Bell size={37} />} title="つながりの、つづき。">
          <p>ログインして通知を確認しましょう。</p>
          <button className="button" onClick={openLogin}>
            ログイン
          </button>
        </Empty>
      ) : error ? (
        <ErrorState error={error} />
      ) : notices.isPending || !ready ? (
        <Spinner />
      ) : notices.isError && !notices.data ? (
        <ErrorState error={notices.error} retry={() => void notices.refetch()} />
      ) : (
        <>
          {items.map((n) => {
            const mod = moderateNotification(n, opts).ui('contentList')
            const record = knownRecord(n.record)
            const target = ['like', 'repost', 'like-via-repost', 'repost-via-repost'].includes(
              n.reason,
            )
              ? n.reasonSubject
              : record
                ? n.uri
                : undefined
            const labels: Record<string, string> = {
              like: 'がいいねしました',
              repost: 'がリポストしました',
              follow: 'にフォローされました',
              mention: 'があなたにメンションしました',
              reply: 'が返信しました',
              quote: 'が引用しました',
              'like-via-repost': 'があなたのリポストにいいねしました',
              'repost-via-repost': 'があなたのリポストをリポストしました',
            }
            return (
              <article
                className={`notification ${!n.isRead ? 'unread' : ''}`}
                key={`${n.uri}:${n.reason}`}
              >
                <span className={`notification-icon ${n.reason}`}>
                  {n.reason.includes('like') ? (
                    <Heart size={19} fill="currentColor" />
                  ) : n.reason.includes('repost') ? (
                    <Repeat2 size={21} />
                  ) : n.reason === 'follow' ? (
                    <UserPlus size={20} />
                  ) : n.reason === 'quote' ? (
                    <Quote size={20} />
                  ) : (
                    <MessageCircle size={20} />
                  )}
                </span>
                <div>
                  <Link to={profilePath(n.author.did)}>
                    <Avatar src={n.author.avatar} name={n.author.handle} size={34} />
                  </Link>
                  <p>
                    <Link to={profilePath(n.author.did)}>
                      <strong>{n.author.displayName || n.author.handle}</strong>
                    </Link>
                    {labels[n.reason] ?? 'からの通知'}
                  </p>
                  {target && (
                    <Link className="notification-preview" to={threadPath(target)}>
                      {mod.blur || mod.noOverride
                        ? 'このコンテンツは非表示です。'
                        : record?.text || '投稿を表示'}
                    </Link>
                  )}
                  <small className="muted">{new Date(n.indexedAt).toLocaleString('ja-JP')}</small>
                </div>
                {!n.isRead && <span className="unread-dot" />}
              </article>
            )
          })}
          {!items.length && <Empty title="通知はまだありません" />}
          <LoadMore
            hasMore={notices.hasNextPage}
            loading={notices.isFetchingNextPage}
            load={() => void notices.fetchNextPage()}
          />
          {notices.isFetchNextPageError && (
            <ErrorState error={notices.error} retry={() => void notices.fetchNextPage()} />
          )}
        </>
      )}
    </>
  )
}
