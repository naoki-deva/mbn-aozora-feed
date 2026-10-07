import { useState, useEffect, useRef } from 'react'
import { ImagePlus, Video, X, Send, Link2 } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useApp } from '../lib/context'
import { queryClient } from '../lib/query'
import { publishPost, getRecord, type ImageAttachment } from '../lib/api'
import { errorMessage, graphemeLength, threadPath } from '../lib/preferences'
import { useNavigate } from 'react-router-dom'
import { Modal, Avatar } from './ui'
function Attachment({
  image,
  onAlt,
  remove,
}: {
  image: ImageAttachment
  onAlt: (alt: string) => void
  remove: () => void
}) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const value = URL.createObjectURL(image.file)
    if (ref.current) ref.current.src = value
    return () => URL.revokeObjectURL(value)
  }, [image.file])
  return (
    <div className="attachment">
      <div>
        <img ref={ref} alt={image.alt} />
        <button className="icon-button" aria-label="添付画像を削除" onClick={remove} type="button">
          <X size={16} />
        </button>
      </div>
      <label>
        代替テキスト
        <input
          maxLength={2000}
          value={image.alt}
          onChange={(e) => onAlt(e.target.value)}
          placeholder="画像の説明を入力"
        />
      </label>
    </div>
  )
}
export function Composer() {
  const { agent, did, handle, prefs, composer, closeComposer, toast } = useApp()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [video, setVideo] = useState<File>()
  const [videoAlt, setVideoAlt] = useState('')
  const [adult, setAdult] = useState(false)
  const [language, setLanguage] = useState(prefs.language)
  const [replyRule, setReplyRule] = useState<
    'all' | 'none' | 'following' | 'followers' | 'mentioned'
  >('all')
  const [allowQuotes, setAllowQuotes] = useState(true)
  const [externalOpen, setExternalOpen] = useState(false)
  const [external, setExternal] = useState({ uri: '', title: '', description: '' })
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const count = graphemeLength(text)
  const action = useMutation({
    mutationFn: () =>
      publishPost(
        agent,
        {
          text,
          images,
          video,
          videoAlt,
          quote: composer?.quote,
          reply: composer?.reply,
          language,
          adult,
          replyRule,
          allowQuotes,
          external: externalOpen && external.uri ? external : undefined,
        },
        setProgress,
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: [did] })
      closeComposer()
      toast('投稿しました')
      navigate(threadPath(result.uri))
    },
    onError: (err) => {
      setError(errorMessage(err))
      setProgress('')
    },
  })
  const dirty = !!(text || images.length || video || external.uri)
  const requestClose = () => {
    if (action.isPending) return
    if (dirty) setDiscard(true)
    else closeComposer()
  }
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  const target = composer?.reply ?? composer?.quote
  return (
    <Modal
      title={composer?.reply ? '返信する' : composer?.quote ? '引用する' : '新しい投稿'}
      onClose={requestClose}
      wide
    >
      <form
        className="modal-body composer-form"
        onSubmit={(e) => {
          e.preventDefault()
          setError('')
          action.mutate()
        }}
      >
        {target && (
          <div className="compose-reference">
            <small>
              {composer?.reply ? '返信先' : '引用元'} @{target.author.handle}
            </small>
            <p>{getRecord(target)?.text}</p>
          </div>
        )}
        <div className="compose-author">
          <Avatar name={handle || ''} size={36} />
          <strong>@{handle}</strong>
          <span className="pill">Bluesky</span>
        </div>
        <label className="sr-only" htmlFor="post-text">
          投稿内容
        </label>
        <textarea
          id="post-text"
          data-autofocus
          placeholder="いま、どんな空の下にいますか？"
          className="compose-text"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={action.isPending}
        />
        {!!images.length && (
          <div className="attachments">
            {images.map((image, i) => (
              <Attachment
                key={i}
                image={image}
                onAlt={(alt) =>
                  setImages((prev) =>
                    prev.map((item, idx) => (idx === i ? { ...item, alt } : item)),
                  )
                }
                remove={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
              />
            ))}
          </div>
        )}
        {video && (
          <div className="notice">
            <Video size={19} />
            <div>
              <strong>{video.name}</strong>
              <label>
                動画の説明
                <input
                  maxLength={1000}
                  value={videoAlt}
                  onChange={(e) => setVideoAlt(e.target.value)}
                />
              </label>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="動画を削除"
              onClick={() => setVideo(undefined)}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {externalOpen && (
          <div className="stack field-panel">
            <label>
              リンクURL
              <input
                type="url"
                value={external.uri}
                onChange={(e) => setExternal({ ...external, uri: e.target.value })}
              />
            </label>
            <label>
              リンクのタイトル
              <input
                value={external.title}
                maxLength={1000}
                onChange={(e) => setExternal({ ...external, title: e.target.value })}
              />
            </label>
            <label>
              説明
              <input
                value={external.description}
                maxLength={1000}
                onChange={(e) => setExternal({ ...external, description: e.target.value })}
              />
            </label>
          </div>
        )}
        <div className="compose-toolbar">
          <div className="toolbar-tools">
            <label
              className={`icon-button ${video || action.isPending ? 'disabled' : ''}`}
              title="画像を追加"
            >
              <ImagePlus size={21} />
              <span className="sr-only">画像を追加</span>
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={!!video || action.isPending}
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])]
                  e.target.value = ''
                  if (images.length + files.length > 4) {
                    setError('画像は4枚まで添付できます。')
                    return
                  }
                  if (files.some((f) => f.size > 1_000_000)) {
                    setError('画像は1枚1MB以下にしてください。')
                    return
                  }
                  setImages((prev) => [...prev, ...files.map((file) => ({ file, alt: '' }))])
                  setExternalOpen(false)
                }}
              />
            </label>
            <label
              className={`icon-button ${images.length || action.isPending ? 'disabled' : ''}`}
              title="動画を追加"
            >
              <Video size={21} />
              <span className="sr-only">動画を追加</span>
              <input
                className="sr-only"
                type="file"
                accept="video/mp4"
                disabled={!!images.length || action.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file && file.size > 100_000_000) setError('動画は100MB以下にしてください。')
                  else {
                    setVideo(file)
                    setExternalOpen(false)
                  }
                }}
              />
            </label>
            <button
              className="icon-button"
              type="button"
              title="リンクカードを追加"
              aria-label="リンクカードを追加"
              disabled={!!images.length || !!video || action.isPending}
              onClick={() => setExternalOpen(!externalOpen)}
            >
              <Link2 size={21} />
            </button>
          </div>
          <span className={`character-count ${count > 300 ? 'danger-text' : ''}`}>
            {count} / 300
          </span>
        </div>
        <details className="compose-options">
          <summary>言語・返信・引用・コンテンツの設定</summary>
          <div className="form-grid">
            <label>
              投稿の言語
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="ja">日本語</option>
                <option value="en">English</option>
                <option value="ko">한국어</option>
                <option value="zh">中文</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
              </select>
            </label>
            <label>
              返信できる人
              <select
                value={replyRule}
                onChange={(e) => setReplyRule(e.target.value as typeof replyRule)}
              >
                <option value="all">全員</option>
                <option value="following">フォローしている人</option>
                <option value="followers">フォロワー</option>
                <option value="mentioned">メンションした人</option>
                <option value="none">返信を許可しない</option>
              </select>
            </label>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={allowQuotes}
              onChange={(e) => setAllowQuotes(e.target.checked)}
            />
            引用を許可する
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            性的なコンテンツのラベルを付ける
          </label>
        </details>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {progress && (
          <p role="status" className="text-small muted">
            {progress}
          </p>
        )}
        {discard ? (
          <div className="notice">
            <span>書きかけの投稿を破棄しますか？</span>
            <button type="button" className="text-button" onClick={() => setDiscard(false)}>
              編集を続ける
            </button>
            <button type="button" className="text-button danger-text" onClick={closeComposer}>
              破棄する
            </button>
          </div>
        ) : (
          <div className="form-actions">
            <span className="muted text-small">あなたの言葉で、あなたらしく。</span>
            <button
              className="button"
              disabled={
                action.isPending || count > 300 || (!text.trim() && !images.length && !video)
              }
            >
              <Send size={16} />
              {action.isPending ? '送信中…' : '投稿する'}
            </button>
          </div>
        )}
      </form>
    </Modal>
  )
}
