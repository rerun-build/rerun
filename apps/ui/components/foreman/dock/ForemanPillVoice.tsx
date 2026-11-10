'use client'

import { TextShimmer } from '@rerun/ui'
import { useTranslations } from 'next-intl'

import { LiveWaveform } from '@/components/ui/live-waveform'

export type ForemanVoicePhase = 'listening' | 'transcribing'

type ForemanPillVoiceProps = {
    phase: ForemanVoicePhase
    /** The recorder's own microphone. Without it the waveform idles: it would open a second one. */
    stream: MediaStream | null
}

/** Space held down: the field turns into the voice being recorded, then into its transcription. */
export function ForemanPillVoice({ phase, stream }: ForemanPillVoiceProps) {
    const t = useTranslations('foreman.voice')
    const hearing = phase === 'listening' && stream !== null
    return (
        <span role="status" className="flex h-full min-w-0 flex-1 items-center gap-3">
            <LiveWaveform active={hearing} processing={!hearing} stream={stream ?? undefined} mode="static" height={24} barWidth={3} barGap={1} barRadius={1.5} className="w-32 shrink-0 text-foreground" />
            {phase === 'listening' ? (
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                    <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive" />
                    <span className="truncate">{t('listening')}</span>
                </span>
            ) : (
                <TextShimmer className="max-w-full truncate text-sm">{t('transcribing')}</TextShimmer>
            )}
        </span>
    )
}
