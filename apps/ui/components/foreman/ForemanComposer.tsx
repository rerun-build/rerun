'use client'

import type { ChatStatus } from 'ai'
import { FOREMAN_AGENT_ID, MAX_UPLOAD_FILE_BYTES } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useMemo, type ComponentProps, type RefObject } from 'react'

import { Context } from '@/components/ai-elements/context'
import { ChatComposer, type ChatComposerHandle, type ComposerQueue } from '@/components/chat/ChatComposer'
import { ForemanModelPill } from '@/components/foreman/ForemanModelPill'
import type { ContextStats } from '@/lib/chat/context-stats'
import { modelContextWindow } from '@/lib/engine/models'
import type { ForemanBackend } from '@/lib/foreman/phase'
import { FOREMAN_MAX_UPLOAD_BYTES } from '@/lib/foreman/upload-limit'

export type ForemanComposerProps = {
    sessionId: string
    backend: ForemanBackend
    status: ChatStatus
    busy: boolean
    queue: ComposerQueue
    onSend: (text: string) => void
    onStop: () => void
    onUploadingChange: (uploading: boolean) => void
    composerRef: RefObject<ChatComposerHandle | null>
    filesOnEngine: boolean
    contextStats: ContextStats | null
    ownEntry?: boolean
} & ForemanComposerMentionProps

export type ForemanComposerMentionProps = Pick<ComponentProps<typeof ChatComposer>, 'textareaRef' | 'textareaProps' | 'mentionTokens'>

export function ForemanComposer({ sessionId, backend, status, busy, queue, onSend, onStop, onUploadingChange, composerRef, filesOnEngine, contextStats, ownEntry = false, textareaRef, textareaProps, mentionTokens }: ForemanComposerProps) {
    const t = useTranslations('foreman')
    const onEngineFiles = backend === 'engine' && filesOnEngine
    const uploadTarget = useMemo(() => (onEngineFiles ? ({ kind: 'agent', agentId: FOREMAN_AGENT_ID } as const) : ({ kind: 'foreman', sessionId } as const)), [onEngineFiles, sessionId])

    return (
        <ChatComposer
            ref={composerRef}
            uid="foreman"
            uploadTarget={uploadTarget}
            maxFileSize={onEngineFiles ? MAX_UPLOAD_FILE_BYTES : FOREMAN_MAX_UPLOAD_BYTES}
            status={status}
            busy={busy}
            queue={queue}
            onSend={onSend}
            onStop={onStop}
            onUploadingChange={onUploadingChange}
            textareaRef={textareaRef}
            textareaProps={textareaProps}
            mentionTokens={mentionTokens}
            attachmentsEnabled={!ownEntry && (backend === 'hub' || filesOnEngine)}
            {...(ownEntry ? { placeholder: t('ownEntryPlaceholder') } : {})}
            modelSlot={<ForemanModelPill backend={backend} />}
            contextSlot={contextStats && <Context usedTokens={contextStats.used} maxTokens={contextStats.max ?? modelContextWindow(contextStats.model, contextStats.provider)} usage={contextStats.usage} modelId={contextStats.model} />}
        />
    )
}
