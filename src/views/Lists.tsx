import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  AppBskyGraphList,
  AppBskyGraphListitem,
  AppBskyGraphStarterpack,
  RichText,
  moderateUserList,
  moderateProfile,
  type AppBskyGraphDefs,
} from '@atproto/api'
import { List, Plus, Pencil, Trash2, Users, ArrowUpRight, VolumeX, ShieldOff } from 'lucide-react'
import { useApp, useModeration } from '../lib/context'
import { createList, deleteRecord, listSource } from '../lib/api'
import { feedPath, listPath } from '../lib/preferences'
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
import { ProfileCard } from '../components/ProfileCard'
import { RichText as Text } from '../components/RichText'
import { FeedCard } from './Feeds'
function ListCard({ list }: { list: AppBskyGraphDefs.ListView }) {
  const { opts, ready } = useModeration()
  const mod = moderateUserList(list, opts).ui('contentList')
  if (!ready || mod.filter || mod.noOverride) return null
  return (
    <Link className="list-card" to={listPath(list.uri)}>
      <span className="list-card-icon">
        <List size={23} />
      </span>
      <div>
        <strong>{list.name}</strong>
        <p>{mod.blur ? 'この説明は表示設定で非表示です。' : list.description}</p>
        <small className="muted">
          {list.purpose === 'app.bsky.graph.defs#modlist'
            ? 'モデレーションリスト'
            : 'ユーザーリスト'}{' '}
          · {list.listItemCount ?? 0}人
        </small>
      </div>
      <ArrowUpRight size={18} />
    </Link>
  )
}
export function ActorLists({ actor }: { actor: string }) {
  const { agent, did } = useApp()
  const lists = useInfiniteQuery({
    queryKey: [did, 'actorLists', actor],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (await agent.app.bsky.graph.getLists({ actor, limit: 30, cursor: pageParam }, { signal }))
        .data,
    getNextPageParam: (page) => page.cursor,
  })
  return lists.isPending ? (
    <Spinner />
  ) : lists.isError && !lists.data ? (
    <ErrorState error={lists.error} retry={() => void lists.refetch()} />
  ) : (
    <>
      <div className="page-body list-stack">
        {lists.data?.pages
          .flatMap((p) => p.lists)
          .map((list) => (
            <ListCard key={list.uri} list={list} />
          ))}
      </div>
      {!lists.data?.pages[0].lists.length && <Empty title="リストはまだありません" />}
      <LoadMore
        hasMore={lists.hasNextPage}
        loading={lists.isFetchingNextPage}
        load={() => void lists.fetchNextPage()}
      />
      {lists.isFetchNextPageError && (
        <ErrorState error={lists.error} retry={() => void lists.fetchNextPage()} />
      )}
    </>
  )
}
function ListEditor({ list, onClose }: { list?: AppBskyGraphDefs.ListView; onClose: () => void }) {
  const { agent, did } = useApp()
  const navigate = useNavigate()
  const [name, setName] = useState(list?.name ?? '')
  const [description, setDescription] = useState(list?.description ?? '')
  const [purpose, setPurpose] = useState<'curation' | 'moderation'>(
    list?.purpose === 'app.bsky.graph.defs#modlist' ? 'moderation' : 'curation',
  )
  const save = useAction(
    async () => {
      if (list) {
        const rkey = list.uri.split('/').at(-1)!
        const current = await agent.app.bsky.graph.list.get({ repo: did!, rkey })
        if (!AppBskyGraphList.validateRecord(current.value).success)
          throw new Error('リストのレコードを確認できません。')
        const rich = new RichText({ text: description })
        await rich.detectFacets(agent)
        await agent.com.atproto.repo.putRecord({
          repo: did!,
          collection: 'app.bsky.graph.list',
          rkey,
          swapRecord: current.cid,
          record: {
            ...current.value,
            name,
            description: rich.text,
            descriptionFacets: rich.facets,
          },
        })
      } else {
        const uri = await createList(agent, name.trim(), description, purpose)
        navigate(listPath(uri))
      }
    },
    list ? 'リストを更新しました' : 'リストを作成しました',
    onClose,
  )
  return (
    <Modal
      title={list ? 'リストを編集' : 'リストを作る'}
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
          リスト名
          <input
            data-autofocus
            required
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          説明
          <textarea
            value={description}
            maxLength={300}
            rows={4}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {!list && (
          <label>
            用途
            <select value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
              <option value="curation">ユーザーをまとめる・フィードを作る</option>
              <option value="moderation">まとめてミュート・ブロックする</option>
            </select>
          </label>
        )}
        <p className="muted text-small">リストと登録したユーザーは公開されます。</p>
        <button className="button" disabled={save.isPending || !name.trim()}>
          {save.isPending ? '保存中…' : '保存する'}
        </button>
      </form>
    </Modal>
  )
}
function PackEditor({ onClose }: { onClose: () => void }) {
  const { agent, did, prefs } = useApp()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [list, setList] = useState('')
  const [feeds, setFeeds] = useState<string[]>([])
  const lists = useInfiniteQuery({
    queryKey: [did, 'packLists'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      (await agent.app.bsky.graph.getLists({ actor: did!, limit: 100, cursor: pageParam })).data,
    getNextPageParam: (page) => page.cursor,
  })
  const save = useAction(
    async () => {
      const rich = new RichText({ text: description })
      await rich.detectFacets(agent)
      const result = await agent.app.bsky.graph.starterpack.create(
        { repo: did! },
        {
          name: name.trim(),
          description: rich.text,
          descriptionFacets: rich.facets,
          list,
          feeds: feeds.map((uri) => ({ uri })),
          createdAt: new Date().toISOString(),
        },
      )
      navigate(`/starter-pack/${encodeURIComponent(result.uri)}`)
    },
    'スターターパックを作成しました',
    onClose,
  )
  return (
    <Modal
      title="スターターパックを作る"
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
          名前
          <input required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          説明
          <textarea
            maxLength={500}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          紹介するユーザーリスト
          <select value={list} onChange={(e) => setList(e.target.value)} required>
            <option value="">リストを選ぶ</option>
            {lists.data?.pages
              .flatMap((p) => p.lists)
              .filter((l) => l.purpose !== 'app.bsky.graph.defs#modlist')
              .map((l) => (
                <option key={l.uri} value={l.uri}>
                  {l.name}
                </option>
              ))}
          </select>
        </label>
        {lists.isPending && <Spinner />}
        {lists.isError && <ErrorState error={lists.error} />}
        {lists.hasNextPage && (
          <button
            type="button"
            className="text-button"
            disabled={lists.isFetchingNextPage}
            onClick={() => void lists.fetchNextPage()}
          >
            リストをもっと読み込む
          </button>
        )}
        <p className="muted text-small">「リスト」画面で先に紹介するユーザーを登録してください。</p>
        <fieldset>
          <legend>紹介するフィード（5つまで）</legend>
          {prefs.feeds
            .filter((f) => f.kind === 'feed')
            .map((f) => (
              <label className="checkbox-label" key={f.id}>
                <input
                  type="checkbox"
                  checked={feeds.includes(f.uri!)}
                  disabled={!feeds.includes(f.uri!) && feeds.length >= 5}
                  onChange={(e) =>
                    setFeeds(
                      e.target.checked ? [...feeds, f.uri!] : feeds.filter((x) => x !== f.uri),
                    )
                  }
                />
                {f.name}
              </label>
            ))}
        </fieldset>
        <button className="button" disabled={save.isPending || !name.trim() || !list}>
          {save.isPending ? '作成中…' : '作成する'}
        </button>
      </form>
    </Modal>
  )
}
export function Lists() {
  const { did, openLogin } = useApp()
  const [creating, setCreating] = useState(false)
  const [pack, setPack] = useState(false)
  const [tab, setTab] = useState<'lists' | 'packs'>('lists')
  return (
    <>
      <PageHeader title="リストとスターターパック" eyebrow="CURATE YOUR CONNECTIONS" />
      <div className="feed-tabs" role="tablist" aria-label="リストの種類">
        <button role="tab" aria-selected={tab === 'lists'} onClick={() => setTab('lists')}>
          リスト
        </button>
        <button role="tab" aria-selected={tab === 'packs'} onClick={() => setTab('packs')}>
          スターターパック
        </button>
      </div>
      {did ? (
        <>
          <div className="page-body">
            <button
              className="button secondary small"
              onClick={() => (tab === 'lists' ? setCreating(true) : setPack(true))}
            >
              <Plus size={16} />
              {tab === 'lists' ? 'リストを作る' : 'スターターパックを作る'}
            </button>
          </div>
          {tab === 'lists' ? <ActorLists actor={did} /> : <ActorStarterPacks actor={did} />}
        </>
      ) : (
        <Empty icon={<List size={37} />} title="つながりを、自分で編む。">
          <p>ログインしてリストを作りましょう。</p>
          <button className="button" onClick={openLogin}>
            ログイン
          </button>
        </Empty>
      )}
      {creating && <ListEditor onClose={() => setCreating(false)} />}
      {pack && <PackEditor onClose={() => setPack(false)} />}
    </>
  )
}
export function ListPage() {
  const { uri = '' } = useParams()
  const { agent, did, addFeed, prefs, requireAuth } = useApp()
  const { opts, ready, error: moderationError } = useModeration()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [member, setMember] = useState('')
  const [reveal, setReveal] = useState(false)
  const lists = useInfiniteQuery({
    queryKey: [did, 'list', uri],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (await agent.app.bsky.graph.getList({ list: uri, limit: 50, cursor: pageParam }, { signal }))
        .data,
    getNextPageParam: (page) => page.cursor,
  })
  const list = lists.data?.pages[0].list
  const items = lists.data?.pages.flatMap((p) => p.items) ?? []
  const own = list?.creator.did === did
  const action = useAction<'add' | 'mute' | 'block' | 'delete' | string>(async (kind) => {
    if (kind === 'add') {
      const profile = await agent.getProfile({ actor: member.trim().replace(/^@/, '') })
      if (items.some((i) => i.subject.did === profile.data.did))
        throw new Error('このユーザーはすでに登録されています。')
      // Check all indexed pages to avoid duplicates beyond the first page.
      let cursor: string | undefined
      do {
        const page = await agent.app.bsky.graph.getList({ list: uri, limit: 100, cursor })
        if (page.data.items.some((i) => i.subject.did === profile.data.did))
          throw new Error('このユーザーはすでに登録されています。')
        cursor = page.data.cursor
      } while (cursor)
      await agent.app.bsky.graph.listitem.create(
        { repo: did! },
        { list: uri, subject: profile.data.did, createdAt: new Date().toISOString() },
      )
      setMember('')
      return
    }
    if (kind === 'mute')
      return list?.viewer?.muted ? agent.unmuteModList(uri) : agent.muteModList(uri)
    if (kind === 'block')
      return list?.viewer?.blocked ? agent.unblockModList(uri) : agent.blockModList(uri)
    if (kind === 'delete') {
      const ownedItems: string[] = []
      let cursor: string | undefined
      do {
        const page = await agent.com.atproto.repo.listRecords({
          repo: did!,
          collection: 'app.bsky.graph.starterpack',
          limit: 100,
          cursor,
        })
        if (
          page.data.records.some(
            (r) => AppBskyGraphStarterpack.validateRecord(r.value).success && r.value.list === uri,
          )
        )
          throw new Error('このリストを使うスターターパックを先に削除してください。')
        cursor = page.data.cursor
      } while (cursor)
      do {
        const page = await agent.com.atproto.repo.listRecords({
          repo: did!,
          collection: 'app.bsky.graph.listitem',
          limit: 100,
          cursor,
        })
        page.data.records.forEach((r) => {
          if (AppBskyGraphListitem.validateRecord(r.value).success && r.value.list === uri)
            ownedItems.push(r.uri)
        })
        cursor = page.data.cursor
      } while (cursor)
      for (let i = 0; i < ownedItems.length; i += 199) {
        await agent.com.atproto.repo.applyWrites({
          repo: did!,
          writes: ownedItems.slice(i, i + 199).map((value) => ({
            $type: 'com.atproto.repo.applyWrites#delete' as const,
            collection: 'app.bsky.graph.listitem',
            rkey: value.split('/').at(-1)!,
          })),
        })
      }
      await deleteRecord(agent, uri)
      navigate('/lists')
      return
    }
    return deleteRecord(agent, kind)
  })
  if (lists.isPending || (!ready && !moderationError)) return <Spinner />
  if ((lists.isError && !lists.data) || moderationError)
    return <ErrorState error={lists.error ?? moderationError} retry={() => void lists.refetch()} />
  const ui = moderateUserList(list!, opts).ui('contentView')
  if (ui.noOverride || ui.filter || (ui.blur && !reveal))
    return (
      <>
        <PageHeader title="リスト" back />
        <Empty title="このリストは非表示です">
          {!ui.noOverride && !ui.filter && (
            <button className="button secondary" onClick={() => setReveal(true)}>
              表示する
            </button>
          )}
        </Empty>
      </>
    )
  return (
    <>
      <PageHeader
        title={list!.name}
        back
        actions={
          own && (
            <div className="button-row">
              <button
                className="icon-button"
                aria-label="リストを編集"
                onClick={() => setEditing(true)}
              >
                <Pencil size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="リストを削除"
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={18} />
              </button>
            </div>
          )
        }
      />
      <div className="page-body">
        <Avatar src={list!.avatar} name={list!.name} size={58} />
        <p>
          <Text text={list!.description ?? ''} facets={list!.descriptionFacets} />
        </p>
        <p className="muted text-small">
          作成者 @{list!.creator.handle} · {list!.listItemCount ?? items.length}人
        </p>
        <div className="button-row">
          {list!.purpose === 'app.bsky.graph.defs#curatelist' ? (
            <>
              <Link className="button small secondary" to={feedPath(uri)}>
                フィードを見る
              </Link>
              <button
                className="button small"
                disabled={prefs.feeds.some((f) => f.id === uri)}
                onClick={() => addFeed(listSource(list!))}
              >
                <Plus size={15} />
                ホームに追加
              </button>
            </>
          ) : list!.purpose === 'app.bsky.graph.defs#modlist' ? (
            <>
              <button
                className="button small secondary"
                disabled={action.isPending}
                onClick={() => {
                  if (requireAuth()) action.mutate('mute')
                }}
              >
                <VolumeX size={15} />
                {list!.viewer?.muted ? 'ミュート解除' : '全員をミュート'}
              </button>
              <button
                className="button small secondary"
                disabled={action.isPending}
                onClick={() => {
                  if (requireAuth()) action.mutate('block')
                }}
              >
                <ShieldOff size={15} />
                {list!.viewer?.blocked ? 'ブロック解除' : '全員をブロック'}
              </button>
            </>
          ) : null}
        </div>
        {own && (
          <form
            className="inline-form spaced"
            onSubmit={(e) => {
              e.preventDefault()
              action.mutate('add')
            }}
          >
            <input
              aria-label="追加するユーザーのハンドル"
              placeholder="ハンドルでユーザーを追加"
              value={member}
              onChange={(e) => setMember(e.target.value)}
              required
            />
            <button className="button small" disabled={action.isPending}>
              追加
            </button>
          </form>
        )}
      </div>
      <div className="section-label">登録したユーザー</div>
      {items.map((item) => (
        <ProfileCard
          key={item.uri}
          profile={item.subject}
          extra={
            own ? (
              <button
                className="icon-button"
                aria-label={`${item.subject.handle}をリストから削除`}
                disabled={action.isPending}
                onClick={() => action.mutate(item.uri)}
              >
                <XIcon />
              </button>
            ) : undefined
          }
        />
      ))}
      {!items.length && <Empty title="まだ誰も登録されていません" />}
      <LoadMore
        hasMore={lists.hasNextPage}
        loading={lists.isFetchingNextPage}
        load={() => void lists.fetchNextPage()}
      />
      {lists.isFetchNextPageError && (
        <ErrorState error={lists.error} retry={() => void lists.fetchNextPage()} />
      )}
      {editing && <ListEditor list={list} onClose={() => setEditing(false)} />}
      {deleting && (
        <Confirm
          title="リストを削除しますか？"
          onClose={() => setDeleting(false)}
          onConfirm={() => action.mutate('delete')}
          pending={action.isPending}
        >
          リストと登録したメンバーを削除します。アカウントやフォロー関係は削除されません。
        </Confirm>
      )}
    </>
  )
}
function XIcon() {
  return <Trash2 size={16} />
}
export function ActorStarterPacks({ actor }: { actor: string }) {
  const { agent, did } = useApp()
  const { opts, ready } = useModeration()
  const packs = useInfiniteQuery({
    queryKey: [did, 'starterPacks', actor],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await agent.app.bsky.graph.getActorStarterPacks(
          { actor, cursor: pageParam, limit: 30 },
          { signal },
        )
      ).data,
    getNextPageParam: (page) => page.cursor,
  })
  return packs.isPending ? (
    <Spinner />
  ) : packs.isError && !packs.data ? (
    <ErrorState error={packs.error} />
  ) : (
    <>
      <div className="page-body list-stack">
        {packs.data?.pages
          .flatMap((p) => p.starterPacks)
          .map((pack) => {
            const record = AppBskyGraphStarterpack.validateRecord(pack.record).success
              ? (pack.record as AppBskyGraphStarterpack.Record)
              : undefined
            const ui = moderateUserList(
              {
                uri: pack.uri,
                cid: pack.cid,
                name: record?.name ?? '',
                labels: pack.labels,
                purpose: 'app.bsky.graph.defs#referencelist',
              },
              opts,
            ).ui('contentList')
            const creator = moderateProfile(pack.creator, opts).ui('profileList')
            return record &&
              ready &&
              !ui.filter &&
              !ui.noOverride &&
              !ui.blur &&
              !creator.filter &&
              !creator.noOverride ? (
              <Link
                className="list-card"
                to={`/starter-pack/${encodeURIComponent(pack.uri)}`}
                key={pack.uri}
              >
                <span className="list-card-icon">
                  <Users size={23} />
                </span>
                <div>
                  <strong>{record.name}</strong>
                  <p>{record.description}</p>
                  <small className="muted">{pack.listItemCount ?? 0}人</small>
                </div>
                <ArrowUpRight size={18} />
              </Link>
            ) : null
          })}
      </div>
      {!packs.data?.pages[0].starterPacks.length && (
        <Empty title="スターターパックはまだありません" />
      )}
      <LoadMore
        hasMore={packs.hasNextPage}
        loading={packs.isFetchingNextPage}
        load={() => void packs.fetchNextPage()}
      />
    </>
  )
}
export function StarterPackPage() {
  const { uri = '' } = useParams()
  const { agent, did } = useApp()
  const { opts, ready, error } = useModeration()
  const [reveal, setReveal] = useState(false)
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const pack = useQuery({
    queryKey: [did, 'starterPack', uri],
    queryFn: async ({ signal }) =>
      (await agent.app.bsky.graph.getStarterPack({ starterPack: uri }, { signal })).data
        .starterPack,
  })
  const remove = useAction(async () => {
    await deleteRecord(agent, uri)
    navigate('/lists')
  })
  if (error) return <ErrorState error={error} />
  if (!ready || pack.isPending) return <Spinner />
  if (pack.isError) return <ErrorState error={pack.error} retry={() => void pack.refetch()} />
  const record = AppBskyGraphStarterpack.validateRecord(pack.data.record).success
    ? (pack.data.record as AppBskyGraphStarterpack.Record)
    : undefined
  const ui = moderateUserList(
    {
      uri: pack.data.uri,
      cid: pack.data.cid,
      name: record?.name ?? '',
      labels: pack.data.labels,
      purpose: 'app.bsky.graph.defs#referencelist',
    },
    opts,
  ).ui('contentView')
  const creator = moderateProfile(pack.data.creator, opts).ui('profileView')
  if (
    ui.filter ||
    ui.noOverride ||
    creator.filter ||
    creator.noOverride ||
    ((ui.blur || creator.blur) && !reveal)
  )
    return (
      <>
        <PageHeader title="スターターパック" back />
        <Empty title="このスターターパックは非表示です">
          {!ui.filter && !ui.noOverride && !creator.filter && !creator.noOverride && (
            <button className="button secondary" onClick={() => setReveal(true)}>
              表示する
            </button>
          )}
        </Empty>
      </>
    )
  return (
    <>
      <PageHeader
        title={record?.name ?? 'スターターパック'}
        back
        actions={
          pack.data.creator.did === did && (
            <button
              className="icon-button"
              aria-label="スターターパックを削除"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={18} />
            </button>
          )
        }
      />
      <div className="page-body">
        <p>{record?.description}</p>
        <p className="muted">by @{pack.data.creator.handle}</p>
        {pack.data.list && (
          <Link className="button secondary small" to={listPath(pack.data.list.uri)}>
            登録したユーザーをすべて見る
          </Link>
        )}
      </div>
      <div className="section-label">紹介するユーザー</div>
      {pack.data.listItemsSample?.map((i) => (
        <ProfileCard key={i.uri} profile={i.subject} />
      ))}
      {!!pack.data.feeds?.length && (
        <>
          <div className="section-label">紹介するフィード</div>
          <div className="page-body feed-grid">
            {pack.data.feeds.map((f) => (
              <FeedCard key={f.uri} feed={f} />
            ))}
          </div>
        </>
      )}
      {deleting && (
        <Confirm
          title="スターターパックを削除しますか？"
          onClose={() => setDeleting(false)}
          onConfirm={() => remove.mutate()}
          pending={remove.isPending}
        >
          スターターパックを削除します。元のユーザーリストは残ります。
        </Confirm>
      )}
    </>
  )
}
