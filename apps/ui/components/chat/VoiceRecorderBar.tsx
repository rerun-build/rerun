'use client'

import { Shimmer } from '@/components/ai-elements/shimmer'
import { LiveWaveform } from '@/components/ui/live-waveform'
import type { VoiceLiveState } from '@/hooks/useVoiceRecorder'
import { formatVoiceDuration } from '@/lib/voice/duration'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

const REFRESH_MS = 50

/**
 * `processing` is the composer sending a voice message, `transcribing` an answer being turned into
 * words: the first says nothing while it works, the second says so.
 */
export type VoiceRecorderBarStatus = 'starting' | 'recording' | 'processing' | 'transcribing' | 'failed'

// The composer's bar stands on its own above the dock; the answer one sits in the row the textarea
// was in, so it carries no padding and no height of its own.
const SIZES = {
    composer: { box: 'min-h-16 w-full gap-3 px-3 py-2', waveform: 48, startingLabel: 'waitingForMicrophone' },
    answer: { box: 'min-h-7 min-w-0 flex-1 gap-2', waveform: 24, startingLabel: 'microphone' },
} as const

type VoiceRecorderBarProps = {
    status: VoiceRecorderBarStatus
    /** The recorder's own microphone, so the waveform draws off it instead of opening a second one. */
    stream: MediaStream | null
    getLiveState: () => VoiceLiveState
    size?: keyof typeof SIZES
}

/**
 * Replaces the field a recording is made from: the composer's textarea, or a question's answer row.
 * The timer is polled here rather than pushed down as props: at 20 reads a second, driving it from
 * the chat's own state would re-render the whole conversation.
 */
export function VoiceRecorderBar({ status, stream, getLiveState, size = 'composer' }: VoiceRecorderBarProps) {
    const t = useTranslations('chat.voice')
    const [durationMs, setDurationMs] = useState(0)
    const layout = SIZES[size]

    useEffect(() => {
        if (status !== 'recording') return
        const id = setInterval(() => setDurationMs(getLiveState().durationMs), REFRESH_MS)
        return () => clearInterval(id)
    }, [status, getLiveState])

    if (status === 'failed') {
        return (
            <div className={cn('flex items-center gap-2 text-sm', layout.box)}>
                <span className="text-destructive">{t('sendFailed')}</span>
                <span className="text-muted-foreground">{t('sendFailedHint')}</span>
            </div>
        )
    }

    const recording = status === 'recording'
    // Without the recorder's stream the waveform would open a microphone of its own: it idles instead.
    const hearing = recording && stream !== null

    return (
        <div className={cn('flex items-center', layout.box)}>
            <div className="min-w-0 flex-1">
                <LiveWaveform active={hearing} processing={!hearing} stream={stream ?? undefined} mode="static" height={layout.waveform} barWidth={3} barGap={1} barRadius={1.5} className="w-full text-foreground" />
            </div>
            {recording && (
                <div className="flex shrink-0 items-center gap-1.5">
                    <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatVoiceDuration(durationMs)}</span>
                </div>
            )}
            {status === 'starting' && (
                <Shimmer as="span" className="shrink-0 text-xs">
                    {t(layout.startingLabel)}
                </Shimmer>
            )}
            {status === 'transcribing' && (
                <Shimmer as="span" className="shrink-0 text-xs">
                    {t('transcribing')}
                </Shimmer>
            )}
        </div>
    )
}
