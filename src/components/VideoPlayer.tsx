import { useEffect, useRef } from 'react'
import { safeUrl } from '../lib/preferences'
export function VideoPlayer({
  playlist,
  thumbnail,
  alt,
}: {
  playlist: string
  thumbnail?: string
  alt?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    const url = safeUrl(playlist)
    if (!video || !url) return
    let disposed = false
    let destroy: (() => void) | undefined
    if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url
    else
      void import('hls.js')
        .then(({ default: Hls }) => {
          if (disposed || !Hls.isSupported()) return
          const hls = new Hls({ autoStartLoad: false })
          hls.loadSource(url)
          hls.attachMedia(video)
          const load = () => hls.startLoad()
          video.addEventListener('pointerdown', load, { once: true })
          video.addEventListener('keydown', load, { once: true })
          video.addEventListener('play', load, { once: true })
          // Load manifests when the user requests playback, never autoplay.
          destroy = () => {
            video.removeEventListener('play', load)
            video.removeEventListener('pointerdown', load)
            video.removeEventListener('keydown', load)
            hls.destroy()
          }
        })
        .catch(() => {
          /* The direct playlist link remains available. */
        })
    return () => {
      disposed = true
      destroy?.()
      video.removeAttribute('src')
      video.load()
    }
  }, [playlist])
  return (
    <video
      ref={ref}
      controls
      preload="none"
      poster={safeUrl(thumbnail)}
      aria-label={alt || '投稿の動画'}
      playsInline
    />
  )
}
