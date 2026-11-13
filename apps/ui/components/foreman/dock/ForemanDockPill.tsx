'use client'

import { useState, type RefObject } from 'react'
import type { BorderBeamProps } from '@rerun/ui'

import { ForemanPill, type ForemanPillSide } from './ForemanPill'
import { ForemanPillField } from './ForemanPillField'
import { ForemanPillTicker } from './ForemanPillTicker'
import { ForemanPillVoice, type ForemanVoicePhase } from './ForemanPillVoice'

export type ForemanDockPillMode = { kind: 'field' } | { kind: 'ticker'; label: string | null } | { kind: 'voice'; phase: ForemanVoicePhase; stream: MediaStream | null }

const REST_WIDTH = 'w-[340px]'
const TICKER_WIDTH = 'w-[420px]'
const WRITING_WIDTH = 'w-[480px]'

type ForemanDockPillProps = {
    side: ForemanPillSide
    mode: ForemanDockPillMode
    tone?: BorderBeamProps['tone']
    hidden?: boolean
    /** The pill's own box, for whoever has to keep clear of it. */
    ref?: RefObject<HTMLDivElement | null>
    mod: string
    inputRef: RefObject<HTMLInputElement | null>
    onSubmit: (text: string) => void
    /** The field took the caret: whatever it needs to send had better be on its way. */
    onEngage: () => void
}

/** The pill in whichever of its three lives the Foreman is in: a field, its run, or a voice. */
export function ForemanDockPill({ side, mode, tone, hidden, ref, mod, inputRef, onSubmit, onEngage }: ForemanDockPillProps) {
    const [draft, setDraft] = useState('')
    const [focused, setFocused] = useState(false)
    const writing = mode.kind === 'field' && (focused || draft.length > 0)
    const width = mode.kind === 'voice' || writing ? WRITING_WIDTH : mode.kind === 'ticker' ? TICKER_WIDTH : REST_WIDTH

    return (
        <ForemanPill ref={ref} side={side} width={width} tone={tone} hidden={hidden}>
            {mode.kind === 'voice' ? (
                <ForemanPillVoice phase={mode.phase} stream={mode.stream} />
            ) : mode.kind === 'ticker' ? (
                <ForemanPillTicker label={mode.label} />
            ) : (
                <ForemanPillField
                    inputRef={inputRef}
                    mod={mod}
                    draft={draft}
                    focused={focused}
                    onDraftChange={setDraft}
                    onFocusChange={setFocused}
                    onEngage={onEngage}
                    onSubmit={() => {
                        const text = draft.trim()
                        if (!text) return
                        setDraft('')
                        onSubmit(text)
                    }}
                />
            )}
        </ForemanPill>
    )
}
