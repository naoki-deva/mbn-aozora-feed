import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AppBskyEmbedImages,
  AppBskyEmbedVideo,
  AppBskyEmbedExternal,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  moderatePost,
  type AppBskyFeedDefs,
} from '@atproto/api'
import { ArrowUpRight, ShieldAlert } from 'lucide-react'
import { safeUrl, profilePath, threadPath, feedPath, listPath } from '../lib/preferences'
import { useModeration } from '../lib/context'
import { knownRecord } from '../lib/api'
import { RichText } from './RichText'
import { VideoPlayer } from './VideoPlayer'
import { Avatar, Modal } from './ui'
type Embed = AppBskyFeedDefs.PostView['embed']
function Quote({ record }: { record: AppBskyEmbedRecord.View['record'] }) {
  const { opts, ready } = useModeration()
  const [reveal, setReveal] = useState(false)
  if (AppBskyEmbedRecord.isViewBlocked(record))
    return <div className="quote muted">ブロックされた投稿です。</div>
  if (AppBskyEmbedRecord.isViewNotFound(record) || AppBskyEmbedRecord.isViewDetached(record))
    return <div className="quote muted">引用元の投稿を表示できません。</div>
  if (!AppBskyEmbedRecord.isViewRecord(record)) {
    if (
      'uri' in record &&
      typeof record.uri === 'string' &&
      'displayName' in record &&
      typeof record.displayName === 'string'
    )
      return (
        <Link className="quote block" to={feedPath(record.uri)}>
          {record.displayName} <ArrowUpRight size={15} />
        </Link>
      )
    if (
      'uri' in record &&
      typeof record.uri === 'string' &&
      'name' in record &&
      typeof record.name === 'string'
    )
      return (
        <Link className="quote block" to={listPath(record.uri)}>
          {record.name} <ArrowUpRight size={15} />
        </Link>
      )
    return <div className="quote muted">引用されたコンテンツ</div>
  }
  const post: AppBskyFeedDefs.PostView = {
    uri: record.uri,
    cid: record.cid,
    author: record.author,
    record: record.value,
    labels: record.labels,
    indexedAt: record.indexedAt,
    embed: record.embeds?.[0],
  }
  const decision = moderatePost(post, opts)
  const ui = decision.ui('contentView')
  const media = decision.ui('contentMedia')
  if (!ready || ui.filter || ui.noOverride || (ui.blur && !reveal))
    return (
      <div className="quote notice">
        <ShieldAlert size={18} />
        <span>引用元のコンテンツは非表示です。</span>
        {ready && !ui.noOverride && !ui.filter && (
          <button className="text-button" onClick={() => setReveal(true)}>
            表示する
          </button>
        )}
      </div>
    )
  const value = knownRecord(record.value)
  return (
    <div className="quote">
      <Link className="quote-author" to={profilePath(record.author.did)}>
        <Avatar
          src={record.author.avatar}
          name={record.author.displayName || record.author.handle}
          size={23}
          blurred={decision.ui('avatar').blur}
        />
        <strong>{record.author.displayName || record.author.handle}</strong>
        <span className="muted">@{record.author.handle}</span>
      </Link>
      <RichText text={value?.text ?? ''} facets={value?.facets} />
      {record.embeds?.map((e, i) =>
        AppBskyEmbedImages.isView(e) ||
        AppBskyEmbedVideo.isView(e) ||
        AppBskyEmbedExternal.isView(e) ? (
          <Embeds key={i} embed={e} blurred={media.blur} noOverride={media.noOverride} />
        ) : null,
      )}
      <Link className="small-link" to={threadPath(record.uri)}>
        投稿を見る
      </Link>
    </div>
  )
}
export function Embeds({
  embed,
  blurred = false,
  noOverride = false,
}: {
  embed: Embed
  blurred?: boolean
  noOverride?: boolean
}) {
  const [reveal, setReveal] = useState(false)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string }>()
  if (!embed) return null
  if (noOverride || (blurred && !reveal))
    return (
      <div className="media-warning">
        <ShieldAlert size={24} />
        <p>センシティブなメディア</p>
        {!noOverride && (
          <button className="button secondary small" onClick={() => setReveal(true)}>
            表示する
          </button>
        )}
      </div>
    )
  if (AppBskyEmbedRecordWithMedia.isView(embed))
    return (
      <>
        <Embeds embed={embed.media} blurred={blurred} noOverride={noOverride} />
        <Quote record={embed.record.record} />
      </>
    )
  if (AppBskyEmbedRecord.isView(embed)) return <Quote record={embed.record} />
  if (AppBskyEmbedImages.isView(embed))
    return (
      <>
        <div className={`image-grid count-${embed.images.length}`}>
          {embed.images.map((image, index) =>
            safeUrl(image.thumb) ? (
              <button
                key={index}
                className="image-button"
                onClick={() =>
                  setLightbox({
                    src: safeUrl(image.fullsize) ?? safeUrl(image.thumb)!,
                    alt: image.alt,
                  })
                }
                aria-label={image.alt || `画像${index + 1}を拡大`}
              >
                <img src={safeUrl(image.thumb)} alt={image.alt} loading="lazy" />
                {image.alt && <span className="alt-badge">ALT</span>}
              </button>
            ) : null,
          )}
        </div>
        {lightbox && (
          <Modal title="画像" onClose={() => setLightbox(undefined)} wide>
            <div className="lightbox">
              <img src={lightbox.src} alt={lightbox.alt} />
              {lightbox.alt && <p>{lightbox.alt}</p>}
            </div>
          </Modal>
        )}
      </>
    )
  if (AppBskyEmbedVideo.isView(embed))
    return safeUrl(embed.playlist) ? (
      <div className="video-embed">
        <VideoPlayer playlist={embed.playlist} thumbnail={embed.thumbnail} alt={embed.alt} />
        <a className="small-link" href={safeUrl(embed.playlist)} target="_blank" rel="noreferrer">
          動画を開く
        </a>
        {embed.alt && <p className="muted text-small">{embed.alt}</p>}
      </div>
    ) : null
  if (AppBskyEmbedExternal.isView(embed)) {
    const url = safeUrl(embed.external.uri)
    if (!url) return null
    return (
      <a className="external-card" href={url} target="_blank" rel="noreferrer">
        {safeUrl(embed.external.thumb) && (
          <img src={safeUrl(embed.external.thumb)} alt="" loading="lazy" />
        )}
        <div>
          <small>
            {new URL(url).hostname}
            <ArrowUpRight size={13} />
          </small>
          <strong>{embed.external.title}</strong>
          <p>{embed.external.description}</p>
        </div>
      </a>
    )
  }
  return null
}
