'use client'

import { Shimmer } from '@/components/ai-elements/shimmer'
import { LiveWaveform } from '@/components/ui/live-waveform'
import type { VoiceMessageStatus } from '@/hooks/useVoiceMessage'
import type { VoiceLiveState } from '@/hooks/useVoiceRecorder'
import { formatVoiceDuration } from '@/lib/voice/duration'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

const REFRESH_MS = 50
const WAVEFORM_HEIGHT = 48

type VoiceRecorderBarProps = {
    status: Exclude<VoiceMessageStatus, 'idle'>
    /** The recorder's own microphone, so the waveform draws off it instead of opening a second one. */
    stream: MediaStream | null
    getLiveState: () => VoiceLiveState
}

/**
 * Replaces the composer's textarea while a voice message is being recorded or sent. The timer is
 * polled here rather than pushed down as props: at 20 reads a second, driving it from the chat's
 * own state would re-render the whole conversation. The explicit `w-full` matters: the composer's
 * InputGroup lays its children out with `items-center`, so a bar without a width of its own
 * collapses to the width of its content.
 */
export function VoiceRecorderBar({ status, stream, getLiveState }: VoiceRecorderBarProps) {
    const t = useTranslations('chat.voice')
    const [durationMs, setDurationMs] = useState(0)

    useEffect(() => {
        if (status !== 'recording') return
        const id = setInterval(() => setDurationMs(getLiveState().durationMs), REFRESH_MS)
        return () => clearInterval(id)
    }, [status, getLiveState])

    if (status === 'failed') {
        return (
            <div className="flex min-h-16 w-full items-center gap-2 px-3 py-2 text-sm">
                <span className="text-destructive">{t('sendFailed')}</span>
                <span className="text-muted-foreground">{t('sendFailedHint')}</span>
            </div>
        )
    }

    const recording = status === 'recording'

    return (
        <div className="flex min-h-16 w-full items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
                <LiveWaveform
                    active={recording}
                    processing={!recording}
                    stream={stream ?? undefined}
                    mode="static"
                    height={WAVEFORM_HEIGHT}
                    barWidth={3}
                    barGap={1}
                    barRadius={1.5}
                    className="w-full text-foreground"
                />
            </div>
            {recording && (
                <div className="flex shrink-0 items-center gap-1.5">
                    <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatVoiceDuration(durationMs)}</span>
                </div>
            )}
            {status === 'starting' && (
                <Shimmer as="span" className="shrink-0 text-xs">
                    {t('waitingForMicrophone')}
                </Shimmer>
            )}
        </div>
    )
}
