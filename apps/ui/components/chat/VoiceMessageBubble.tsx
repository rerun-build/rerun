'use client'

import { VoiceWaveform } from '@/components/chat/VoiceWaveform'
import type { VoicePlayback } from '@/components/chat/useVoicePlayback'
import { Spinner } from '@/components/ui/spinner'
import { PauseIcon, Play } from '@/lib/icons'
import { formatVoiceDuration } from '@/lib/voice/duration'
import { PEAK_COUNT } from '@/lib/voice/peaks'
import { BorderBeam } from '@rerun/ui'

type VoiceMessageBubbleProps = {
    playback: VoicePlayback
    durationMs: number
    peaks: number[]
}

/** The player drawn inside the user bubble: play, the waveform to seek on, the timer. */
export function VoiceMessageBubble({ playback, durationMs, peaks }: VoiceMessageBubbleProps) {
    const { available, loading, playing, elapsedMs, progress, toggle, seekAt, audioProps } = playback
    const levels = peaks.length > 0 ? peaks : Array.from({ length: PEAK_COUNT }, () => 0.25)

    return (
        <div className="flex min-w-0 items-center gap-2.5">
            <button
                type="button"
                onClick={toggle}
                disabled={!available || loading}
                aria-label={playing ? 'Pause' : 'Play voice message'}
                className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground transition-colors hover:bg-foreground/20 disabled:opacity-50 in-data-ink:bg-white/15 in-data-ink:text-white in-data-ink:hover:bg-white/25"
            >
                {loading ? <Spinner /> : playing ? <PauseIcon className="size-4" /> : <Play className="size-4" />}
                {playing && <BorderBeam animated pattern="arcs" tone="neutral" width={1} duration={3} />}
            </button>

            <button
                type="button"
                onClick={event => {
                    const bounds = event.currentTarget.getBoundingClientRect()
                    seekAt((event.clientX - bounds.left) / bounds.width)
                }}
                aria-label="Seek"
                className="flex w-32 shrink-0 cursor-pointer items-center text-foreground in-data-ink:text-white sm:w-40"
            >
                <VoiceWaveform peaks={levels} progress={progress} />
            </button>

            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground in-data-ink:text-white/70">{formatVoiceDuration(playing || elapsedMs > 0 ? elapsedMs : durationMs)}</span>

            <audio {...audioProps} />
        </div>
    )
}
