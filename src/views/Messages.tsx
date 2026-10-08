import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { RichText, ChatBskyConvoDefs, ChatBskyActorDefs, type AtpAgent } from '@atproto/api'
import {
  MessageCircle,
  Plus,
  Send,
  VolumeX,
  LogOut,
  Users,
  Trash2,
  Flag,
  Smile,
  CheckCheck,
} from 'lucide-react'
import { useApp } from '../lib/context'
import { errorMessage, graphemeLength, profilePath } from '../lib/preferences'
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
import { RichText as Text } from '../components/RichText'
import { Embeds } from '../components/Embeds'
function useChat() {
  const { agent } = useApp()
  return useMemo(() => agent.withProxy('bsky_chat', 'did:web:api.bsky.chat'), [agent])
}
function NewConversation({ onClose }: { onClose: () => void }) {
  const { agent } = useApp()
  const chat = useChat()
  const navigate = useNavigate()
  const [handles, setHandles] = useState('')
  const [group, setGroup] = useState(false)
  const [name, setName] = useState('')
  const action = useAction(
    async () => {
      const input = handles
        .split(/[\s,、]+/)
        .map((s) => s.trim().replace(/^@/, ''))
        .filter(Boolean)
      if (!input.length || input.length > 99 || (!group && input.length !== 1))
        throw new Error(
          group ? 'メンバーを1〜99人指定してください。' : '宛先を1人指定してください。',
        )
      const profiles = await Promise.all(input.map((actor) => agent.getProfile({ actor })))
      const members = [...new Set(profiles.map((p) => p.data.did))]
      const result = group
        ? await chat.chat.bsky.group.createGroup({ members, name: name.trim() })
        : await chat.chat.bsky.convo.getConvoForMembers({ members })
      navigate(`/messages/${result.data.convo.id}`)
    },
    undefined,
    onClose,
  )
  return (
    <Modal
      title="新しい会話"
      onClose={() => {
        if (!action.isPending) onClose()
      }}
    >
      <form
        className="modal-body stack"
        onSubmit={(e) => {
          e.preventDefault()
          action.mutate()
        }}
      >
        <label>
          会話の種類
          <select
            value={group ? 'group' : 'direct'}
            onChange={(e) => setGroup(e.target.value === 'group')}
          >
            <option value="direct">ダイレクトメッセージ</option>
            <option value="group">グループ</option>
          </select>
        </label>
        {group && (
          <label>
            グループ名
            <input required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>
          {group ? 'メンバーのハンドル（カンマ・改行で区切る）' : '相手のハンドル'}
          <textarea
            data-autofocus
            required
            rows={group ? 4 : 2}
            value={handles}
            onChange={(e) => setHandles(e.target.value)}
            placeholder="you.bsky.social"
          />
        </label>
        <p className="muted text-small">
          相手の受信設定によってはメッセージを送れない場合があります。
        </p>
        <button className="button" disabled={action.isPending || !handles.trim()}>
          {action.isPending ? '接続中…' : '会話をはじめる'}
        </button>
      </form>
    </Modal>
  )
}
export function Messages() {
  const { did, openLogin } = useApp()
  const chat = useChat()
  const [creating, setCreating] = useState(false)
  const [requests, setRequests] = useState(false)
  const convos = useInfiniteQuery({
    queryKey: [did, 'conversations', requests],
    enabled: !!did,
    refetchInterval: 15_000,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await chat.chat.bsky.convo.listConvos(
          { limit: 30, cursor: pageParam, status: requests ? 'request' : 'accepted' },
          { signal },
        )
      ).data,
    getNextPageParam: (page) => page.cursor,
  })
  return (
    <>
      <PageHeader
        title="メッセージ"
        eyebrow="A QUIETER CONVERSATION"
        actions={
          did && (
            <button
              className="icon-button"
              aria-label="新しい会話"
              onClick={() => setCreating(true)}
            >
              <Plus size={21} />
            </button>
          )
        }
      />
      <div className="feed-tabs" role="tablist" aria-label="会話の種類">
        <button role="tab" aria-selected={!requests} onClick={() => setRequests(false)}>
          受信トレイ
        </button>
        <button role="tab" aria-selected={requests} onClick={() => setRequests(true)}>
          リクエスト
        </button>
      </div>
      {!did ? (
        <Empty icon={<MessageCircle size={38} />} title="少し、話そう。">
          <p>ログインするとDMを利用できます。</p>
          <button className="button" onClick={openLogin}>
            ログイン
          </button>
        </Empty>
      ) : convos.isPending ? (
        <Spinner />
      ) : convos.isError && !convos.data ? (
        <>
          <ErrorState error={convos.error} retry={() => void convos.refetch()} />
          <p className="muted text-small page-body">
            DMへのアクセスを許可したアプリパスワードが必要です。
          </p>
        </>
      ) : (
        <>
          {convos.data?.pages
            .flatMap((p) => p.convos)
            .map((convo) => {
              const other = convo.members.find((m) => m.did !== did)
              const group = ChatBskyConvoDefs.isGroupConvo(convo.kind) ? convo.kind : undefined
              const last = ChatBskyConvoDefs.isMessageView(convo.lastMessage)
                ? convo.lastMessage.text
                : ''
              return (
                <Link
                  className={`conversation-row ${convo.unreadCount ? 'unread' : ''}`}
                  to={`/messages/${convo.id}`}
                  key={convo.id}
                >
                  <Avatar
                    src={other?.avatar}
                    name={group?.name ?? other?.handle ?? '?'}
                    size={46}
                  />
                  <div>
                    <strong>{group?.name ?? other?.displayName ?? other?.handle ?? '会話'}</strong>
                    {group && <Users size={13} />}
                    <p>
                      {last || (requests ? '新しいメッセージのリクエスト' : 'メッセージを送る')}
                    </p>
                  </div>
                  {convo.muted && <VolumeX size={15} className="muted" />}
                  {convo.unreadCount > 0 && <span className="count-pill">{convo.unreadCount}</span>}
                </Link>
              )
            })}
          {!convos.data?.pages[0].convos.length && (
            <Empty title={requests ? 'リクエストはありません' : '会話はまだありません'} />
          )}
          <LoadMore
            hasMore={convos.hasNextPage}
            loading={convos.isFetchingNextPage}
            load={() => void convos.fetchNextPage()}
          />
          {convos.isFetchNextPageError && (
            <ErrorState error={convos.error} retry={() => void convos.fetchNextPage()} />
          )}
        </>
      )}
      {creating && <NewConversation onClose={() => setCreating(false)} />}
    </>
  )
}
function Message({
  message,
  chat,
  convoId,
}: {
  message: ChatBskyConvoDefs.MessageView
  chat: AtpAgent
  convoId: string
}) {
  const { did } = useApp()
  const [deleting, setDeleting] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const mine = message.sender.did === did
  const action = useAction<'delete' | 'react' | 'report'>(async (kind) => {
    if (kind === 'delete') {
      await chat.chat.bsky.convo.deleteMessageForSelf({ convoId, messageId: message.id })
      setDeleting(false)
    }
    if (kind === 'react') {
      const own = message.reactions?.some((r) => r.sender.did === did && r.value === '❤️')
      return own
        ? chat.chat.bsky.convo.removeReaction({ convoId, messageId: message.id, value: '❤️' })
        : chat.chat.bsky.convo.addReaction({ convoId, messageId: message.id, value: '❤️' })
    }
    if (kind === 'report') {
      await chat.com.atproto.moderation.createReport({
        reasonType: 'com.atproto.moderation.defs#reasonOther',
        reason: reason || undefined,
        subject: Object.assign(
          { $type: 'chat.bsky.convo.defs#messageRef' },
          { did: message.sender.did, convoId, messageId: message.id },
        ),
      })
      setReporting(false)
    }
  })
  return (
    <div className={`message ${mine ? 'mine' : ''}`}>
      <div className="message-bubble">
        <Text text={message.text} facets={message.facets} />
        {message.embed && <Embeds embed={message.embed} />}
      </div>
      <div className="message-meta">
        <time>
          {new Date(message.sentAt).toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
        <span>{message.reactions?.map((r) => r.value).join(' ')}</span>
        <button
          className="icon-button"
          aria-label="ハートのリアクションを切り替え"
          disabled={action.isPending}
          onClick={() => action.mutate('react')}
        >
          <Smile size={13} />
        </button>
        <button
          className="icon-button"
          aria-label="メッセージを自分の画面から削除"
          onClick={() => setDeleting(true)}
        >
          <Trash2 size={13} />
        </button>
        {!mine && (
          <button
            className="icon-button"
            aria-label="メッセージを報告"
            onClick={() => setReporting(true)}
          >
            <Flag size={13} />
          </button>
        )}
      </div>
      {deleting && (
        <Confirm
          title="自分の画面から削除しますか？"
          onClose={() => setDeleting(false)}
          onConfirm={() => action.mutate('delete')}
          pending={action.isPending}
        >
          このメッセージを自分の画面から削除します。相手の画面には残ります。
        </Confirm>
      )}
      {reporting && (
        <Modal title="メッセージを報告" onClose={() => setReporting(false)}>
          <form
            className="modal-body stack"
            onSubmit={(e) => {
              e.preventDefault()
              action.mutate('report')
            }}
          >
            <label>
              報告の理由
              <textarea
                required
                rows={4}
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className="button" disabled={action.isPending}>
              報告を送信
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}
function GroupMembers({
  convo,
  onClose,
}: {
  convo: ChatBskyConvoDefs.ConvoView
  onClose: () => void
}) {
  const { agent, did } = useApp()
  const chat = useChat()
  const group = ChatBskyConvoDefs.isGroupConvo(convo.kind) ? convo.kind : undefined
  const self = convo.members.find((m) => m.did === did)
  const owner = ChatBskyActorDefs.isGroupConvoMember(self?.kind) && self.kind.role === 'owner'
  const [handle, setHandle] = useState('')
  const [name, setName] = useState(group?.name ?? '')
  const members = useInfiniteQuery({
    queryKey: [did, 'convoMembers', convo.id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await chat.chat.bsky.convo.getConvoMembers(
          { convoId: convo.id, limit: 50, cursor: pageParam },
          { signal },
        )
      ).data,
    getNextPageParam: (page) => page.cursor,
  })
  const action = useAction<{ kind: 'add' | 'remove' | 'rename'; did?: string }>(async (value) => {
    if (value.kind === 'rename') return chat.chat.bsky.group.editGroup({ convoId: convo.id, name })
    if (value.kind === 'add') {
      const p = await agent.getProfile({ actor: handle.trim().replace(/^@/, '') })
      await chat.chat.bsky.group.addMembers({ convoId: convo.id, members: [p.data.did] })
      setHandle('')
    }
    if (value.kind === 'remove')
      return chat.chat.bsky.group.removeMembers({ convoId: convo.id, members: [value.did!] })
  })
  return (
    <Modal title="会話のメンバー" onClose={onClose}>
      {group && owner && (
        <div className="modal-body stack">
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              action.mutate({ kind: 'rename' })
            }}
          >
            <input
              aria-label="グループ名"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <button className="button small secondary" disabled={action.isPending}>
              名前を変更
            </button>
          </form>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              action.mutate({ kind: 'add' })
            }}
          >
            <input
              aria-label="グループに追加するユーザー"
              placeholder="ハンドルを入力"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              required
            />
            <button className="button small secondary" disabled={action.isPending}>
              追加
            </button>
          </form>
        </div>
      )}
      {members.isPending ? (
        <Spinner />
      ) : members.isError && !members.data ? (
        <ErrorState error={members.error} />
      ) : (
        <>
          {members.data?.pages
            .flatMap((p) => p.members)
            .map((m) => (
              <div className="profile-card" key={m.did}>
                <Avatar src={m.avatar} name={m.handle} size={35} />
                <div>
                  <Link to={profilePath(m.did)}>
                    <strong>{m.displayName || m.handle}</strong>
                  </Link>
                  <small className="handle">@{m.handle}</small>
                </div>
                {group && owner && m.did !== did && (
                  <button
                    className="icon-button"
                    aria-label={`${m.handle}をグループから削除`}
                    disabled={action.isPending}
                    onClick={() => action.mutate({ kind: 'remove', did: m.did })}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          <LoadMore
            hasMore={members.hasNextPage}
            loading={members.isFetchingNextPage}
            load={() => void members.fetchNextPage()}
          />
        </>
      )}
    </Modal>
  )
}
export function Conversation() {
  const { id = '' } = useParams()
  const { did, agent, openLogin, toast } = useApp()
  const chat = useChat()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [leaving, setLeaving] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const convo = useQuery({
    queryKey: [did, 'conversation', id],
    enabled: !!did,
    refetchInterval: 10_000,
    queryFn: async ({ signal }) =>
      (await chat.chat.bsky.convo.getConvo({ convoId: id }, { signal })).data.convo,
  })
  const messages = useInfiniteQuery({
    queryKey: [did, 'messages', id],
    enabled: !!did,
    refetchInterval: 10_000,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await chat.chat.bsky.convo.getMessages(
          { convoId: id, limit: 40, cursor: pageParam },
          { signal },
        )
      ).data,
    getNextPageParam: (page) => page.cursor,
  })
  const newest = messages.data?.pages[0].messages[0]
  const newestId = newest && 'id' in newest && typeof newest.id === 'string' ? newest.id : undefined
  useEffect(() => {
    if (!did || !newestId || !convo.data?.unreadCount) return
    void chat.chat.bsky.convo.updateRead({ convoId: id, messageId: newestId }).catch(() => {
      /* Retry on a later read; no read receipt is fabricated. */
    })
  }, [chat, did, id, newestId, convo.data?.unreadCount])
  const send = useAction(async () => {
    if (!text.trim() || graphemeLength(text) > 1000)
      throw new Error('メッセージは1〜1000文字で入力してください。')
    const rich = new RichText({ text })
    await rich.detectFacets(agent)
    await chat.chat.bsky.convo.sendMessage({
      convoId: id,
      message: { text: rich.text, facets: rich.facets },
    })
    setText('')
  })
  const action = useAction<'mute' | 'leave' | 'accept' | 'read'>(async (kind) => {
    if (kind === 'mute')
      return convo.data?.muted
        ? chat.chat.bsky.convo.unmuteConvo({ convoId: id })
        : chat.chat.bsky.convo.muteConvo({ convoId: id })
    if (kind === 'accept') return chat.chat.bsky.convo.acceptConvo({ convoId: id })
    if (kind === 'read') return chat.chat.bsky.convo.updateRead({ convoId: id })
    if (kind === 'leave') {
      await chat.chat.bsky.convo.leaveConvo({ convoId: id })
      navigate('/messages')
      toast('会話から退出しました')
    }
  })
  if (!did)
    return (
      <Empty title="ログインが必要です">
        <button className="button" onClick={openLogin}>
          ログイン
        </button>
      </Empty>
    )
  if (convo.isPending || messages.isPending) return <Spinner />
  if (convo.isError || (messages.isError && !messages.data))
    return (
      <ErrorState
        error={convo.error ?? messages.error}
        retry={() => {
          void convo.refetch()
          void messages.refetch()
        }}
      />
    )
  const other = convo.data.members.find((m) => m.did !== did)
  const group = ChatBskyConvoDefs.isGroupConvo(convo.data.kind) ? convo.data.kind : undefined
  const request = convo.data.status === 'request'
  const raw = messages.data!.pages.flatMap((p) => p.messages)
  const list = raw
    .filter(ChatBskyConvoDefs.isMessageView)
    .filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i)
    .reverse()
  const locked = group && group.lockStatus !== 'unlocked'
  return (
    <>
      <PageHeader
        title={group?.name ?? other?.displayName ?? other?.handle ?? '会話'}
        back
        actions={
          <div className="button-row">
            <button
              className="icon-button"
              aria-label="メンバーを表示"
              onClick={() => setMembersOpen(true)}
            >
              <Users size={18} />
            </button>
            <button
              className={`icon-button ${convo.data.muted ? 'selected' : ''}`}
              aria-label="会話のミュートを切り替える"
              disabled={action.isPending}
              onClick={() => action.mutate('mute')}
            >
              <VolumeX size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="会話を既読にする"
              disabled={action.isPending}
              onClick={() => action.mutate('read')}
            >
              <CheckCheck size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="会話から退出する"
              onClick={() => setLeaving(true)}
            >
              <LogOut size={18} />
            </button>
          </div>
        }
      />
      <div className="message-list">
        <LoadMore
          hasMore={messages.hasNextPage}
          loading={messages.isFetchingNextPage}
          load={() => void messages.fetchNextPage()}
        />
        {messages.isFetchNextPageError && (
          <ErrorState error={messages.error} retry={() => void messages.fetchNextPage()} />
        )}
        {list.map((m) => (
          <Message key={m.id} message={m} chat={chat} convoId={id} />
        ))}
        {!list.length && <Empty title="最初のメッセージを送ろう" />}
      </div>
      {request ? (
        <div className="page-body notice">
          <span>メッセージのリクエストです。</span>
          <button
            className="button small"
            disabled={action.isPending}
            onClick={() => action.mutate('accept')}
          >
            受け入れる
          </button>
        </div>
      ) : locked ? (
        <div className="page-body notice">このグループはロックされています。</div>
      ) : (
        <form
          className="message-compose"
          onSubmit={(e) => {
            e.preventDefault()
            send.mutate()
          }}
        >
          <label className="sr-only" htmlFor="message-text">
            メッセージ
          </label>
          <textarea
            id="message-text"
            placeholder="メッセージを書く…"
            rows={2}
            value={text}
            disabled={send.isPending}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="button"
            aria-label="メッセージを送信"
            disabled={send.isPending || !text.trim() || graphemeLength(text) > 1000}
          >
            <Send size={19} />
          </button>
          <small className={graphemeLength(text) > 1000 ? 'danger-text' : 'muted'}>
            {graphemeLength(text)} / 1000
          </small>
        </form>
      )}
      {send.isError && (
        <p className="inline-error page-body" role="alert">
          {errorMessage(send.error)}
        </p>
      )}
      {leaving && (
        <Confirm
          title="会話から退出しますか？"
          onClose={() => setLeaving(false)}
          onConfirm={() => action.mutate('leave')}
          pending={action.isPending}
        >
          この会話が受信トレイから削除されます。
        </Confirm>
      )}
      {membersOpen && <GroupMembers convo={convo.data} onClose={() => setMembersOpen(false)} />}
    </>
  )
}
