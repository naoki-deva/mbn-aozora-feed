import { RichText as ProtocolRichText, type AppBskyRichtextFacet } from '@atproto/api'
import { Link } from 'react-router-dom'
import { profilePath, safeUrl } from '../lib/preferences'
export function RichText({ text, facets }: { text: string; facets?: AppBskyRichtextFacet.Main[] }) {
  const rich = new ProtocolRichText({ text, facets })
  return (
    <span className="rich-text">
      {[...rich.segments()].map((segment, index) => {
        const link = segment.link
        const mention = segment.mention
        const tag = segment.tag
        if (link && safeUrl(link.uri))
          return (
            <a key={index} href={safeUrl(link.uri)} target="_blank" rel="noreferrer">
              {segment.text}
            </a>
          )
        if (mention)
          return (
            <Link key={index} to={profilePath(mention.did)}>
              {segment.text}
            </Link>
          )
        if (tag)
          return (
            <Link key={index} to={`/search?q=${encodeURIComponent(`#${tag.tag}`)}`}>
              {segment.text}
            </Link>
          )
        return <span key={index}>{segment.text}</span>
      })}
    </span>
  )
}
