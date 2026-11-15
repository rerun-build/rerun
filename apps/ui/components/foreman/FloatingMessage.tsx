'use client'

import type { UIMessage } from 'ai'
import { motion, useReducedMotion } from 'motion/react'

import type { ReadChatFile } from '@/components/chat/AttachmentLightbox'
import { MessageView, type MessageViewProps } from '@/components/chat/MessageView'
import type { RawUrlFor } from '@/lib/files/raw-url'

type FloatingMessageProps = {
    message: UIMessage
    index: number
    isActive?: boolean
    rawUrlFor?: RawUrlFor
    readFile?: ReadChatFile
    sharedFiles?: MessageViewProps['sharedFiles']
    renderToolPart?: MessageViewProps['renderToolPart']
    mentions?: MessageViewProps['mentions']
    onStopTask?: MessageViewProps['onStopTask']
    onRegenerate?: MessageViewProps['onRegenerate']
    onRateMessage?: MessageViewProps['onRateMessage']
    feedbackRating?: MessageViewProps['feedbackRating']
    hitlCall?: MessageViewProps['hitlCall']
}

export function FloatingMessage({ message, index, isActive, rawUrlFor, readFile, sharedFiles, renderToolPart, mentions, onStopTask, onRegenerate, onRateMessage, feedbackRating, hitlCall }: FloatingMessageProps) {
    const reducedMotion = useReducedMotion()

    return (
        <motion.div
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 14, filter: 'blur(8px)' }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: reducedMotion ? 0 : 0.38, ease: [0.22, 1, 0.36, 1], delay: reducedMotion ? 0 : index * 0.05 }}
        >
            <MessageView message={message} isActive={isActive} rawUrlFor={rawUrlFor} readFile={readFile} sharedFiles={sharedFiles} renderToolPart={renderToolPart} mentions={mentions} onStopTask={onStopTask} onRegenerate={onRegenerate} onRateMessage={onRateMessage} feedbackRating={feedbackRating} hitlCall={hitlCall} />
        </motion.div>
    )
}
