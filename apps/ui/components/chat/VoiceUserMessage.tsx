'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import type { ReadChatFile } from '@/components/chat/AttachmentLightbox'
import { Message, MessageAction, MessageActions, MessageContent } from '@/components/ai-elements/message'
import { USER_BUBBLE_INK, USER_BUBBLE_SHAPE } from '@/components/chat/bubble-styles'
import { CopyAction } from '@/components/chat/CopyAction'
import { MessageAttachments } from '@/components/chat/MessageAttachments'
import { MessageTimeTooltip } from '@/components/chat/MessageTimeTooltip'
import { useVoicePlayback } from '@/components/chat/useVoicePlayback'
import { VoiceMessageBubble } from '@/components/chat/VoiceMessageBubble'
import { VoiceTranscript } from '@/components/chat/VoiceTranscript'
import type { RawUrlFor } from '@/lib/files/raw-url'
import { CaptionsIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { VoiceMessage } from '@/lib/voice/marker'

type VoiceUserMessageProps = {
    voice: VoiceMessage
    agentId?: string
    rawUrlFor?: RawUrlFor
    readFile?: ReadChatFile
    /** Files sent along with the recording, drawn above the bubble. */
    attachmentPaths?: string[]
    createdAt?: string
    defaultTranscriptOpen?: boolean
}

/**
 * A voice message the user sent: the player in the bubble, and under it the actions that slide open
 * what the agent read from it. The actions come up on hover like the agent's, and stay on a touch
 * screen.
 */
export function VoiceUserMessage({ voice, agentId, rawUrlFor, readFile, attachmentPaths, createdAt, defaultTranscriptOpen = false }: VoiceUserMessageProps) {
    const t = useTranslations('chat.voice')
    const playback = useVoicePlayback({ agentId, rawUrlFor, src: voice.src, durationMs: voice.durationMs })
    const [open, setOpen] = useState(defaultTranscriptOpen)
    const transcript = voice.transcript
    const started = playback.playing || playback.elapsedMs > 0

    return (
        <Message from="user">
            {attachmentPaths && attachmentPaths.length > 0 && <MessageAttachments agentId={agentId} paths={attachmentPaths} rawUrlFor={rawUrlFor} readFile={readFile} />}
            <MessageTimeTooltip createdAt={createdAt} side="left">
                <MessageContent className={cn(USER_BUBBLE_SHAPE, USER_BUBBLE_INK)} data-ink>
                    <VoiceMessageBubble playback={playback} durationMs={voice.durationMs} peaks={voice.peaks} />
                </MessageContent>
            </MessageTimeTooltip>
            {transcript && (
                <div className="-mt-1 flex flex-col items-end group-[:not(:last-child)]:-mb-4">
                    <VoiceTranscript transcript={transcript} open={open} heardUpTo={started ? playback.progress : null} />
                    <MessageActions className={cn('transition-opacity group-hover:opacity-100 has-focus-visible:opacity-100 [@media(hover:none)]:opacity-100', !open && 'opacity-0')}>
                        <MessageAction tooltip={open ? t('hideTranscript') : t('transcript')} aria-expanded={open} onClick={() => setOpen(value => !value)} className={cn(open && 'bg-accent text-foreground')}>
                            <CaptionsIcon className="size-3.5" />
                        </MessageAction>
                        <CopyAction text={transcript} tooltip={t('copyTranscript')} />
                    </MessageActions>
                </div>
            )}
        </Message>
    )
}
