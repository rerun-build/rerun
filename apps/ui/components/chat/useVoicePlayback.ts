'use client'

import type { ComponentProps } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { rawUrlResolver, type RawUrlFor } from '@/lib/files/raw-url'

export type VoicePlayback = {
    /** False when nothing can fetch the recording, a gallery's or a mock thread's. */
    available: boolean
    loading: boolean
    playing: boolean
    elapsedMs: number
    /** 0 to 1 through the recording. */
    progress: number
    toggle: () => void
    seekAt: (ratio: number) => void
    audioProps: ComponentProps<'audio'> & { ref: React.RefObject<HTMLAudioElement | null> }
}

/**
 * Plays a voice message, held above the bubble so what sits under it (the transcript) follows the
 * same clock. The audio is fetched only on the first play, so opening a long conversation does not
 * pull every recording in it.
 */
export function useVoicePlayback({ agentId, rawUrlFor, src, durationMs }: { agentId?: string; rawUrlFor?: RawUrlFor; src: string; durationMs: number }): VoicePlayback {
    const rawUrl = rawUrlResolver(agentId, rawUrlFor)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const objectUrlRef = useRef<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [playing, setPlaying] = useState(false)
    const [elapsedMs, setElapsedMs] = useState(0)

    useEffect(
        () => () => {
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        },
        []
    )

    // The engine streams the file whole with no range support, and a MediaRecorder webm carries no
    // duration in its header. Loading the bytes into a blob URL sidesteps both: the browser holds
    // the whole recording and can seek inside it.
    const load = useCallback(async () => {
        if (objectUrlRef.current || !rawUrl) return objectUrlRef.current
        setLoading(true)
        try {
            const res = await fetch(rawUrl(src))
            if (!res.ok) throw new Error('Could not load this recording')
            const url = URL.createObjectURL(await res.blob())
            objectUrlRef.current = url
            return url
        } finally {
            setLoading(false)
        }
    }, [rawUrl, src])

    const toggle = useCallback(async () => {
        const audio = audioRef.current
        if (!audio) return
        if (playing) {
            audio.pause()
            return
        }
        if (!audio.src) {
            const url = await load().catch(() => null)
            if (!url) return
            audio.src = url
        }
        await audio.play().catch(() => {})
    }, [load, playing])

    const seekAt = useCallback(
        (ratio: number) => {
            const audio = audioRef.current
            if (!audio?.src || durationMs <= 0) return
            const clamped = Math.min(1, Math.max(0, ratio))
            audio.currentTime = (clamped * durationMs) / 1000
            setElapsedMs(clamped * durationMs)
        },
        [durationMs]
    )

    return {
        available: !!rawUrl,
        loading,
        playing,
        elapsedMs,
        progress: durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 0,
        toggle: () => void toggle(),
        seekAt,
        audioProps: {
            ref: audioRef,
            preload: 'none',
            onPlay: () => setPlaying(true),
            onPause: () => setPlaying(false),
            onEnded: () => {
                setPlaying(false)
                setElapsedMs(0)
            },
            onTimeUpdate: event => setElapsedMs(event.currentTarget.currentTime * 1000),
            className: 'hidden',
        },
    }
}
