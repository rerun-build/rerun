'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { FilmIcon, Maximize2Icon, Play } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { formatVoiceDuration } from '@/lib/voice/duration'

/** `natural` keeps the file's own proportions, the other two are cells of an album. */
export type MediaTileShape = 'natural' | 'cell' | 'wide'

export const MEDIA_CELL_ASPECT: Record<Exclude<MediaTileShape, 'natural'>, string> = { cell: 'aspect-[4/5]', wide: 'aspect-[2/1]' }

type VideoMeta = { width: number; height: number; duration: number }

const CHAT_VIDEO_PLAY_EVENT = 'chat-video-play'

function readMeta(video: HTMLVideoElement): VideoMeta {
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration }
}

// A portrait clip grows in height and a landscape one in width, the way a lone photo does.
function naturalBox(meta: VideoMeta | null) {
    if (!meta) return { className: 'h-60 aspect-[4/5]', style: undefined }
    const portrait = meta.height >= meta.width
    return { className: portrait ? 'h-72 max-w-full' : 'w-80 max-w-full', style: { aspectRatio: `${meta.width} / ${meta.height}` } }
}

function PlayDisc() {
    return (
        <span className="grid size-12 place-items-center rounded-full bg-white/90 text-black shadow-sm">
            <Play className="size-5 translate-x-px [&_*]:fill-current" />
        </span>
    )
}

function DurationPill({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <span className={cn('inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm', className)}>
            {children}
        </span>
    )
}

type ChatVideoTileProps = {
    src: string
    name: string
    shape: MediaTileShape
    onOpen: () => void
}

/**
 * A video shown by its first frame. A click plays it in place with the sound, a second one pauses it,
 * and the corner button opens the lightbox. Starting one pauses any other playing in the chat.
 */
export function ChatVideoTile({ src, name, shape, onOpen }: ChatVideoTileProps) {
    const t = useTranslations('chat.video')
    const videoRef = useRef<HTMLVideoElement>(null)
    const [meta, setMeta] = useState<VideoMeta | null>(null)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [playback, setPlayback] = useState<'idle' | 'playing' | 'paused'>('idle')
    const [currentTime, setCurrentTime] = useState(0)

    // The metadata can land before React attaches the element's handlers.
    useEffect(() => {
        const video = videoRef.current
        if (!video) return
        if (video.error) return setStatus('error')
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) setMeta(readMeta(video))
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) setStatus('ready')
    }, [])

    useEffect(() => {
        const pauseIfOther = (event: Event) => {
            if ((event as CustomEvent<HTMLVideoElement>).detail !== videoRef.current) videoRef.current?.pause()
        }
        window.addEventListener(CHAT_VIDEO_PLAY_EVENT, pauseIfOther)
        return () => window.removeEventListener(CHAT_VIDEO_PLAY_EVENT, pauseIfOther)
    }, [])

    const togglePlayback = () => {
        const video = videoRef.current
        if (!video) return
        if (!video.paused) return video.pause()
        video.muted = false
        window.dispatchEvent(new CustomEvent(CHAT_VIDEO_PLAY_EVENT, { detail: video }))
        void video.play()
    }

    const box = shape !== 'natural' ? { className: cn('w-full', MEDIA_CELL_ASPECT[shape]), style: undefined } : status === 'error' ? { className: 'size-28', style: undefined } : naturalBox(meta)
    const started = playback !== 'idle'
    const duration = meta?.duration ?? 0

    return (
        <div className={cn('group/video relative overflow-hidden rounded-2xl bg-muted', box.className)} style={box.style}>
            <button
                type="button"
                onClick={status === 'ready' ? togglePlayback : onOpen}
                aria-label={playback === 'playing' ? t('pause', { name }) : t('play', { name })}
                title={name}
                className="absolute inset-0 size-full cursor-pointer"
            >
                {status === 'error' ? (
                    <span className="flex size-full flex-col items-center justify-center gap-1 p-2 text-muted-foreground">
                        <FilmIcon className="size-5" />
                        <span className="line-clamp-2 w-full break-words text-center text-[10px] leading-tight">{name}</span>
                        <span className="text-[10px] text-muted-foreground/70">{t('previewUnavailable')}</span>
                    </span>
                ) : (
                    <video
                        ref={videoRef}
                        src={`${src}#t=0.1`}
                        preload="metadata"
                        muted
                        playsInline
                        className="size-full object-cover"
                        onLoadedMetadata={event => setMeta(readMeta(event.currentTarget))}
                        onLoadedData={() => setStatus('ready')}
                        onError={() => setStatus('error')}
                        onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
                        onPlay={() => setPlayback('playing')}
                        onPause={event => setPlayback(event.currentTarget.ended ? 'idle' : 'paused')}
                        onEnded={() => {
                            setPlayback('idle')
                            setCurrentTime(0)
                        }}
                    />
                )}
            </button>

            {status === 'loading' && <Skeleton className="pointer-events-none absolute inset-0 rounded-none" />}

            {status === 'ready' && (
                <>
                    {playback !== 'playing' && (
                        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10">
                            <PlayDisc />
                        </span>
                    )}
                    <DurationPill className="pointer-events-none absolute right-2 bottom-2">{formatVoiceDuration((started ? duration - currentTime : duration) * 1000)}</DurationPill>
                    {started && duration > 0 && (
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/25">
                            <span className="block h-full bg-white" style={{ width: `${(currentTime / duration) * 100}%` }} />
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            videoRef.current?.pause()
                            onOpen()
                        }}
                        aria-label={t('openFullScreen', { name })}
                        className={cn(
                            'absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-opacity',
                            !started && 'pointer-fine:opacity-0 pointer-fine:group-hover/video:opacity-100 pointer-fine:focus-visible:opacity-100'
                        )}
                    >
                        <Maximize2Icon className="size-3.5" />
                    </button>
                </>
            )}
        </div>
    )
}
