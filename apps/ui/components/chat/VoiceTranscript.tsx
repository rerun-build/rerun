'use client'

import { useMemo } from 'react'

import { cn } from '@/lib/utils'
import { transcriptWords } from '@/lib/voice/marker'

const EASE_OUT = 'ease-[cubic-bezier(0.22,1,0.36,1)]'

type VoiceTranscriptProps = {
    transcript: string
    open: boolean
    /** 0 to 1 through the recording; null until it has been played. */
    heardUpTo: number | null
}

/**
 * What the agent read from a voice message, slid open under the bubble: italic and muted behind a
 * violet bar. While it plays, the words already heard darken. There are no word timestamps, so the
 * pace is spread by length and drifts on long pauses.
 */
export function VoiceTranscript({ transcript, open, heardUpTo }: VoiceTranscriptProps) {
    const words = useMemo(() => transcriptWords(transcript), [transcript])
    return (
        <div className={cn('grid w-full transition-[grid-template-rows] duration-500 motion-reduce:transition-none', EASE_OUT, open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')} aria-hidden={!open} inert={!open}>
            <div className="min-h-0 overflow-hidden">
                <p
                    className={cn(
                        'mt-1 mb-1.5 ml-auto max-w-sm border-r-2 border-brand/35 pr-3 text-right text-[13px] italic leading-relaxed break-words dark:border-brand/70',
                        'transition-[opacity,translate,filter] duration-500 motion-reduce:transition-none',
                        EASE_OUT,
                        open ? 'translate-y-0 opacity-100 blur-none delay-75' : '-translate-y-1 opacity-0 blur-[2px]'
                    )}
                >
                    {words.map((word, index) => (
                        <span key={index} className={cn('transition-colors duration-200', heardUpTo === null ? 'text-muted-foreground' : word.start <= heardUpTo ? 'text-foreground/85' : 'text-muted-foreground/45')}>
                            {word.text}
                        </span>
                    ))}
                </p>
            </div>
        </div>
    )
}
