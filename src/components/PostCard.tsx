import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AppBskyFeedDefs, moderatePost } from '@atproto/api'
import {
  Heart,
  MessageCircle,
  Repeat2,
  Bookmark,
  MoreHorizontal,
  Copy,
  Flag,
  Trash2,
  Pin,
  EyeOff,
  Quote,
  ShieldAlert,
  ArrowUpRight,
} from 'lucide-react'
import { useApp, useModeration } from '../lib/context'
import { getRecord, bskyPostUrl, type Post, type FeedItem } from '../lib/api'
import { profilePath, threadPath, errorMessage } from '../lib/preferences'
import { Avatar, Confirm, useAction } from './ui'
import { RichText } from './RichText'
import { Embeds } from './Embeds'
import { InteractionSettings } from './InteractionSettings'
import { Report } from './Report'
export function PostCard({
  post,
  reason,
  detailed = false,
}: {
  post: Post
  reason?: FeedItem['reason']
  detailed?: boolean
}) {
  const { agent, did, prefs, compose, requireAuth, toast } = useApp()
  const { opts, ready } = useModeration()
  const [reveal, setReveal] = useState(false)
  const [report, setReport] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editingInteractions, setEditingInteractions] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const record = getRecord(post)
  const decision = moderatePost(post, opts)
  const ui = decision.ui(detailed ? 'contentView' : 'contentList')
  const action = useAction<'like' | 'repost' | 'bookmark' | 'hide' | 'pin' | 'delete'>(
    async (kind) => {
      if (kind === 'like')
        return post.viewer?.like
          ? agent.deleteLike(post.viewer.like)
          : agent.like(post.uri, post.cid)
      if (kind === 'repost')
        return post.viewer?.repost
          ? agent.deleteRepost(post.viewer.repost)
          : agent.repost(post.uri, post.cid)
      if (kind === 'bookmark')
        return post.viewer?.bookmarked
          ? agent.app.bsky.bookmark.deleteBookmark({ uri: post.uri })
          : agent.app.bsky.bookmark.createBookmark({ uri: post.uri, cid: post.cid })
      if (kind === 'hide') return agent.hidePost(post.uri)
      if (kind === 'pin')
        return agent.upsertProfile((existing) => ({
          ...existing,
          pinnedPost: { uri: post.uri, cid: post.cid },
        }))
      if (kind === 'delete') {
        await agent.deletePost(post.uri)
        setDeleting(false)
      }
    },
  )
  const run = (kind: 'like' | 'repost' | 'bookmark' | 'hide' | 'pin') => {
    if (requireAuth()) {
      action.mutate(kind)
      setMenuOpen(false)
    }
  }
  if (!ready) return <div className="post-placeholder">表示設定を確認しています…</div>
  if (ui.filter && !detailed) return null
  if (ui.noOverride || (ui.blur && !reveal) || ui.filter)
    return (
      <div className="post-warning">
        <ShieldAlert size={20} />
        <span>モデレーション設定で非表示の投稿です。</span>
        {!ui.noOverride && !ui.filter && (
          <button className="text-button" onClick={() => setReveal(true)}>
            表示する
          </button>
        )}
      </div>
    )
  const repost = AppBskyFeedDefs.isReasonRepost(reason) ? reason : undefined
  const counts = (value?: number) =>
    prefs.hideCounts
      ? ''
      : value
        ? new Intl.NumberFormat('ja', { notation: 'compact' }).format(value)
        : ''
  const date = record?.createdAt ?? post.indexedAt
  return (
    <article className={`post ${prefs.compact ? 'compact' : ''} ${detailed ? 'detailed' : ''}`}>
      {repost && (
        <Link className="repost-reason" to={profilePath(repost.by.did)}>
          <Repeat2 size={13} />
          {repost.by.displayName || repost.by.handle}がリポスト
        </Link>
      )}
      {AppBskyFeedDefs.isReasonPin(reason) && (
        <span className="repost-reason">
          <Pin size={13} />
          固定された投稿
        </span>
      )}
      <div className="post-main">
        <Link to={profilePath(post.author.did)} aria-label={`${post.author.handle}のプロフィール`}>
          <Avatar
            src={post.author.avatar}
            name={post.author.displayName || post.author.handle}
            blurred={decision.ui('avatar').blur}
          />
        </Link>
        <div className="post-content">
          <div className="post-meta">
            <Link className="post-author" to={profilePath(post.author.did)}>
              <strong className={decision.ui('displayName').blur ? 'blurred' : ''}>
                {post.author.displayName || post.author.handle}
              </strong>
              {post.author.verification?.verifiedStatus === 'valid' && (
                <span className="verified" title="認証済み">
                  ✓
                </span>
              )}
              <span className="handle">@{post.author.handle}</span>
            </Link>
            <Link className="post-time" to={threadPath(post.uri)}>
              <time dateTime={date} title={new Date(date).toLocaleString('ja-JP')}>
                {new Date(date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
              </time>
            </Link>
            <div className="post-menu">
              <button
                className="icon-button"
                aria-label="投稿のメニュー"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <MoreHorizontal size={18} />
              </button>
              {menuOpen && (
                <>
                  <button
                    className="menu-dismiss"
                    aria-label="メニューを閉じる"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="dropdown">
                    <button
                      onClick={async () => {
                        setMenuOpen(false)
                        try {
                          await navigator.clipboard.writeText(bskyPostUrl(post))
                          toast('リンクをコピーしました')
                        } catch (error) {
                          toast(errorMessage(error), true)
                        }
                      }}
                    >
                      <Copy size={16} />
                      リンクをコピー
                    </button>
                    <a href={bskyPostUrl(post)} target="_blank" rel="noreferrer">
                      <ArrowUpRight size={16} />
                      Blueskyで開く
                    </a>
                    <button onClick={() => run('hide')}>
                      <EyeOff size={16} />
                      この投稿を非表示
                    </button>
                    {did === post.author.did ? (
                      <>
                        <button
                          onClick={() => {
                            setEditingInteractions(true)
                            setMenuOpen(false)
                          }}
                        >
                          <MessageCircle size={16} />
                          返信と引用の設定
                        </button>
                        <button onClick={() => run('pin')}>
                          <Pin size={16} />
                          プロフィールに固定
                        </button>
                        <button
                          className="danger-text"
                          onClick={() => {
                            setDeleting(true)
                            setMenuOpen(false)
                          }}
                        >
                          <Trash2 size={16} />
                          投稿を削除
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          if (requireAuth()) setReport(true)
                          setMenuOpen(false)
                        }}
                      >
                        <Flag size={16} />
                        報告する
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          {record?.reply && !detailed && (
            <span className="reply-context">
              <MessageCircle size={12} />
              返信 <Link to={threadPath(record.reply.parent.uri)}>返信先を見る</Link>
            </span>
          )}
          {(ui.alert || ui.inform) && (
            <div className="label-info">
              {decision.causes
                .filter((c) => c.type === 'label')
                .map((c) => (c.type === 'label' ? c.label.val : ''))
                .join(' · ') || '表示に関する注意があります'}
            </div>
          )}
          <div className="post-text">
            <RichText text={record?.text ?? ''} facets={record?.facets} />
          </div>
          <Embeds
            embed={post.embed}
            blurred={decision.ui('contentMedia').blur}
            noOverride={decision.ui('contentMedia').noOverride}
          />
          {detailed && (
            <p className="text-small muted">
              <time dateTime={date}>{new Date(date).toLocaleString('ja-JP')}</time>
              {record?.langs && ` · ${record.langs.join(', ')}`}
            </p>
          )}
          <div className="post-actions">
            <button
              aria-label="返信する"
              title="返信"
              disabled={post.viewer?.replyDisabled}
              onClick={() => compose({ reply: post })}
            >
              <MessageCircle size={18} />
              <span>{counts(post.replyCount)}</span>
            </button>
            <button
              className={post.viewer?.repost ? 'active-repost' : ''}
              aria-label={post.viewer?.repost ? 'リポストを取り消す' : 'リポストする'}
              title="リポスト"
              disabled={action.isPending}
              onClick={() => run('repost')}
            >
              <Repeat2 size={19} />
              <span>{counts(post.repostCount)}</span>
            </button>
            <button
              aria-label="引用する"
              title="引用"
              disabled={post.viewer?.embeddingDisabled}
              onClick={() => compose({ quote: post })}
            >
              <Quote size={17} />
              <span>{counts(post.quoteCount)}</span>
            </button>
            <button
              className={post.viewer?.like ? 'active-like' : ''}
              aria-label={post.viewer?.like ? 'いいねを取り消す' : 'いいねする'}
              title="いいね"
              disabled={action.isPending}
              onClick={() => run('like')}
            >
              <Heart size={18} fill={post.viewer?.like ? 'currentColor' : 'none'} />
              <span>{counts(post.likeCount)}</span>
            </button>
            <button
              className={post.viewer?.bookmarked ? 'active-bookmark' : ''}
              aria-label={post.viewer?.bookmarked ? '保存を取り消す' : '投稿を保存'}
              title="保存"
              disabled={action.isPending}
              onClick={() => run('bookmark')}
            >
              <Bookmark size={18} fill={post.viewer?.bookmarked ? 'currentColor' : 'none'} />
            </button>
          </div>
        </div>
      </div>
      {editingInteractions && (
        <InteractionSettings post={post} onClose={() => setEditingInteractions(false)} />
      )}
      {report && (
        <Report subject={{ uri: post.uri, cid: post.cid }} onClose={() => setReport(false)} />
      )}
      {deleting && (
        <Confirm
          title="投稿を削除しますか？"
          onClose={() => setDeleting(false)}
          onConfirm={() => action.mutate('delete')}
          pending={action.isPending}
        >
          この操作は取り消せません。
        </Confirm>
      )}
    </article>
  )
}
