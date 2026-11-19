'use client'

import { MAX_UPLOAD_FILE_BYTES } from '@moldwright/contracts'
import type { ChatStatus, FileUIPart } from 'ai'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, type Ref, type RefObject, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { deleteFileAction } from '@/app/api/_actions/file.actions'
import { deleteForemanFileAction } from '@/app/api/_actions/foreman-file.actions'
import { PromptInput, PromptInputButton, PromptInputDropOverlay, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, usePromptInputAttachments } from '@/components/ai-elements/prompt-input'
import { AttachButton, ChatAttachments } from '@/components/chat/ChatAttachments'
import { ComposerLinkMirror } from '@/components/chat/ComposerLinkMirror'
import { QueuedMessagePill } from '@/components/chat/QueuedMessagePill'
import { VoiceComposerControls } from '@/components/chat/VoiceComposerControls'
import { VoiceRecorderBar } from '@/components/chat/VoiceRecorderBar'
import { MarkdownEditorDialog } from '@/components/ui/markdown-editor-dialog'
import { useComposerDraft } from '@/hooks/useComposerDraft'
import { useComposerLinks } from '@/hooks/useComposerLinks'
import { useFileUploads, type UploadItem, type UploadTarget } from '@/hooks/useFileUploads'
import { useVoiceMessage } from '@/hooks/useVoiceMessage'
import { appendAttachmentsRef, buildAttachmentsRef, CHAT_ATTACHMENTS_DIR, uniqueAttachmentName } from '@/lib/chat/attachments-marker'
import type { ComposerMention } from '@/lib/chat/composer-links'
import { isLongMessage } from '@/lib/composer'
import type { UploadEntry } from '@/lib/files/upload'
import { Maximize2Icon, SendIcon, SquareIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

class SubmitBlocked extends Error {
    silent: boolean
    constructor(message: string, silent = false) {
        super(message)
        this.name = 'SubmitBlocked'
        this.silent = silent
    }
}

export type ComposerQueue = {
    text: string | null
    pending: boolean
    enqueue: (text: string) => void
    onSendNow: () => void
    onDiscard: () => void
}

export type ComposerGate = {
    ready: boolean
    onBlocked: () => void
    hint?: ReactNode
}

export type ChatComposerHandle = {
    restore: (text: string) => boolean
    sync: (text?: string) => void
    focus: () => void
}

export type ChatComposerProps = {
    uid: string
    active?: boolean
    uploadTarget: UploadTarget
    maxFileSize?: number
    status: ChatStatus
    busy: boolean
    onSend: (text: string) => void
    onSent?: () => void
    onStop?: () => void
    queue?: ComposerQueue
    gate?: ComposerGate
    voiceEnabled?: boolean
    attachmentsEnabled?: boolean
    modelSlot?: ReactNode
    contextSlot?: ReactNode
    textareaRef?: RefObject<HTMLTextAreaElement | null>
    textareaProps?: Pick<React.ComponentProps<'textarea'>, 'onChange' | 'onSelect' | 'onKeyDown'>
    mentionTokens?: ComposerMention[]
    onUploadingChange?: (uploading: boolean) => void
    placeholder?: string
    ref?: Ref<ChatComposerHandle>
}

export function ChatComposer({
    uid,
    active = true,
    uploadTarget,
    maxFileSize = MAX_UPLOAD_FILE_BYTES,
    status,
    busy,
    onSend,
    onSent,
    onStop,
    queue,
    gate,
    voiceEnabled = true,
    attachmentsEnabled = true,
    modelSlot,
    contextSlot,
    textareaRef,
    textareaProps,
    mentionTokens,
    onUploadingChange,
    placeholder,
    ref,
}: ChatComposerProps) {
    const t = useTranslations('chat.composer')
    const { load: loadDraft, save: saveDraft, clear: clearDraft } = useComposerDraft(uid)

    const ownRef = useRef<HTMLTextAreaElement | null>(null)
    const inputRef = textareaRef ?? ownRef
    const links = useComposerLinks(mentionTokens)
    const { refresh: refreshLinks, expand: expandLinks, collapse: collapseLinks, clear: clearLinks } = links

    const [expandable, setExpandable] = useState(false)
    const [composerEmpty, setComposerEmpty] = useState(true)
    const [expandOpen, setExpandOpen] = useState(false)
    const [expandValue, setExpandValue] = useState('')
    const [expandSession, setExpandSession] = useState(0)

    const applyComposerText = useCallback(
        (text: string) => {
            saveDraft(expandLinks(text))
            refreshLinks(text)
            setExpandable(isLongMessage(text))
            setComposerEmpty(text.trim().length === 0)
        },
        [saveDraft, expandLinks, refreshLinks]
    )

    const syncComposer = useCallback(() => applyComposerText(inputRef.current?.value ?? ''), [applyComposerText, inputRef])

    useEffect(() => {
        if (active && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus({ preventScroll: true })
    }, [active, inputRef])

    const draftRestoredRef = useRef(false)
    useEffect(() => {
        if (draftRestoredRef.current) return
        const el = inputRef.current
        if (!el) return
        draftRestoredRef.current = true
        const draft = collapseLinks(loadDraft())
        if (draft) {
            el.value = draft
            el.setSelectionRange(draft.length, draft.length)
            refreshLinks(draft)
            setExpandable(isLongMessage(draft))
            setComposerEmpty(draft.trim().length === 0)
        }
    }, [active, inputRef, loadDraft, collapseLinks, refreshLinks])

    useImperativeHandle(
        ref,
        () => ({
            restore: (text: string) => {
                const el = inputRef.current
                if (!el || el.value.trim().length > 0) return false
                const collapsed = collapseLinks(text)
                el.value = collapsed
                el.setSelectionRange(collapsed.length, collapsed.length)
                applyComposerText(collapsed)
                return true
            },
            sync: (text?: string) => applyComposerText(text ?? inputRef.current?.value ?? ''),
            focus: () => inputRef.current?.focus({ preventScroll: true }),
        }),
        [inputRef, applyComposerText, collapseLinks]
    )

    const [uploading, setUploading] = useState(false)
    useEffect(() => {
        onUploadingChange?.(uploading)
    }, [uploading, onUploadingChange])

    const uploads = useFileUploads({
        target: uploadTarget,
        nameFor: uniqueAttachmentName,
        onRejected: message => toast.error(message),
    })

    const [attachmentUploads, setAttachmentUploads] = useState<Record<string, string>>({})

    const handleAttach = useCallback(
        (added: (UploadEntry & { id: string })[]) => {
            const ids = uploads.enqueue(
                added.map(({ file, subDir }) => ({ file, subDir })),
                CHAT_ATTACHMENTS_DIR
            )
            setAttachmentUploads(prev => {
                const next = { ...prev }
                added.forEach(({ id }, index) => {
                    const uploadId = ids[index]
                    if (uploadId) next[id] = uploadId
                })
                return next
            })
        },
        [uploads]
    )

    const deleteUploaded = useCallback(
        (path: string) => {
            if (uploadTarget.kind === 'agent') deleteFileAction(uploadTarget.agentId, path).catch(() => {})
            else if (uploadTarget.kind === 'foreman') deleteForemanFileAction(uploadTarget.sessionId, path).catch(() => {})
        },
        [uploadTarget]
    )

    const handleRemoveAttachment = useCallback(
        (id: string) => {
            const uploadId = attachmentUploads[id]
            if (!uploadId) return
            setAttachmentUploads(prev => {
                const next = { ...prev }
                delete next[id]
                return next
            })
            const item = uploads.byId.get(uploadId)
            if (item?.status === 'done') deleteUploaded(item.path)
            uploads.cancel(uploadId)
        },
        [attachmentUploads, uploads, deleteUploaded]
    )

    const uploadsByAttachment = useMemo(() => {
        const map = new Map<string, UploadItem>()
        for (const [attachmentId, uploadId] of Object.entries(attachmentUploads)) {
            const item = uploads.byId.get(uploadId)
            if (item) map.set(attachmentId, item)
        }
        return map
    }, [attachmentUploads, uploads.byId])

    const retryAttachment = useCallback(
        (attachmentId: string) => {
            const uploadId = attachmentUploads[attachmentId]
            if (uploadId) uploads.retry(uploadId)
        },
        [attachmentUploads, uploads]
    )

    const deliver = useCallback(
        (text: string) => {
            if (busy && queue) {
                queue.enqueue(text)
                return
            }
            onSend(text)
            onSent?.()
        },
        [busy, queue, onSend, onSent]
    )

    const appendUploadedAttachments = useCallback(
        async (text: string, attachedCount: number) => {
            if (attachedCount === 0) return text

            setUploading(true)
            let settled: UploadItem[]
            try {
                settled = await uploads.waitForAll()
            } finally {
                setUploading(false)
            }

            if (settled.length < attachedCount) {
                throw new SubmitBlocked(t('attachmentsMissing'))
            }

            const failed = settled.filter(item => item.status === 'error')
            if (failed.length > 0) {
                throw new SubmitBlocked(t('attachmentsFailed', { count: failed.length }))
            }

            const paths = settled.filter(item => item.status === 'done').map(item => item.path)
            return paths.length > 0 ? appendAttachmentsRef(text, buildAttachmentsRef(paths)) : text
        },
        [uploads, t]
    )

    const handleSubmit = useCallback(
        async ({ text, files }: { text: string; files: FileUIPart[] }) => {
            const trimmed = expandLinks(text).trim()
            clearLinks()
            if (!trimmed && files.length === 0) return
            if (gate && !gate.ready) {
                gate.onBlocked()
                throw new SubmitBlocked('Select a model to start', true)
            }

            const messageText = await appendUploadedAttachments(trimmed, files.length)
            if (!messageText) return
            deliver(messageText)
            setAttachmentUploads({})
            uploads.clearFinished()
            clearDraft()
            setExpandable(false)
            setComposerEmpty(true)
        },
        [gate, uploads, clearDraft, deliver, expandLinks, clearLinks, appendUploadedAttachments]
    )

    const clearAttachmentChipsRef = useRef<() => void>(() => {})

    const sendVoiceMessage = useCallback(
        async (voiceText: string) => {
            const messageText = await appendUploadedAttachments(voiceText, Object.keys(attachmentUploads).length)
            deliver(messageText)
            clearAttachmentChipsRef.current()
            setAttachmentUploads({})
            uploads.clearFinished()
        },
        [appendUploadedAttachments, attachmentUploads, deliver, uploads]
    )

    const voice = useVoiceMessage({ target: uploadTarget, dir: CHAT_ATTACHMENTS_DIR, onSend: sendVoiceMessage })
    const { start: startVoice, finish: finishVoice, retry: retryVoice, discard: discardVoice } = voice

    const startVoiceMessage = useCallback(() => {
        if (gate && !gate.ready) {
            gate.onBlocked()
            return
        }
        void startVoice()
    }, [gate, startVoice])

    const composerHasContent = !composerEmpty || Object.keys(attachmentUploads).length > 0
    const recording = voice.status !== 'idle'
    const voiceControlsVisible = voiceEnabled && (recording || (composerEmpty && status === 'ready' && !uploading && !busy))
    const submitVisible = !recording && !(voiceControlsVisible && !composerHasContent)

    const canQueue = busy && composerHasContent && !uploading
    const submitStatus: ChatStatus = uploading ? 'submitted' : canQueue ? 'ready' : busy && status === 'ready' ? 'streaming' : status
    const showStop = Boolean(onStop) && busy && !uploading && canQueue

    return (
        <>
            {gate?.hint && <div className="mb-2">{gate.hint}</div>}
            <QueuedMessagePill text={queue?.text ?? null} busy={busy} pending={queue?.pending ?? false} onSendNow={() => queue?.onSendNow()} onDiscard={() => queue?.onDiscard()} />
            <PromptInput
                multiple
                maxFiles={attachmentsEnabled ? 10 : 0}
                maxFileSize={maxFileSize}
                onSubmit={handleSubmit}
                onAttach={handleAttach}
                onRemoveAttachment={handleRemoveAttachment}
                onError={({ message }) => toast.error(attachmentsEnabled ? message : t('noFiles'))}
                onSubmitError={error => {
                    if (error instanceof SubmitBlocked && error.silent) return
                    toast.error(error instanceof Error ? error.message : t('sendFailed'))
                }}
            >
                {attachmentsEnabled && <PromptInputDropOverlay />}
                <AttachmentChipsClearer clearRef={clearAttachmentChipsRef} />
                <ChatAttachments uploads={uploadsByAttachment} onRetry={retryAttachment} />
                {voice.status === 'idle' ? (
                    <>
                        <div className="relative w-full">
                            <PromptInputTextarea
                                ref={inputRef}
                                placeholder={placeholder ?? t('placeholder')}
                                className={cn(expandable && 'pr-9', links.hasTokens && 'text-transparent caret-foreground [scrollbar-gutter:stable]')}
                                {...textareaProps}
                                onChange={e => {
                                    textareaProps?.onChange?.(e)
                                    syncComposer()
                                }}
                                onKeyDown={e => {
                                    textareaProps?.onKeyDown?.(e)
                                    if (!e.defaultPrevented) links.handlers.onKeyDown(e)
                                }}
                                onSelect={e => {
                                    links.handlers.onSelect(e)
                                    textareaProps?.onSelect?.(e)
                                }}
                                onPaste={links.handlers.onPaste}
                                onCopy={links.handlers.onCopy}
                                onCut={links.handlers.onCut}
                                onScroll={links.handlers.onScroll}
                                onBlur={syncComposer}
                            />
                            {links.hasTokens && (
                                <ComposerLinkMirror
                                    ref={node => links.attachMirror(node, inputRef.current)}
                                    segments={links.segments}
                                    className={cn('px-2.5 py-2 text-base text-foreground md:text-sm [scrollbar-gutter:stable]', expandable && 'pr-9')}
                                    onPlaceCaret={offset => links.placeCaret(inputRef.current, offset)}
                                    onUnlink={(range, url) => links.unlink(inputRef.current, range, url)}
                                />
                            )}
                        </div>
                        <AnimatePresence>
                            {expandable && (
                                <motion.button
                                    key="expand"
                                    type="button"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    onClick={() => {
                                        setExpandValue(expandLinks(inputRef.current?.value ?? ''))
                                        setExpandSession(session => session + 1)
                                        setExpandOpen(true)
                                    }}
                                    aria-label={t('openEditor')}
                                    title={t('openEditor')}
                                    className="absolute top-1.5 right-1.5 z-10 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                                >
                                    <Maximize2Icon className="size-3.5" />
                                </motion.button>
                            )}
                        </AnimatePresence>
                    </>
                ) : (
                    <VoiceRecorderBar status={voice.status} stream={voice.stream} getLiveState={voice.getLiveState} />
                )}
                <PromptInputFooter>
                    <div className="flex min-w-0 items-center gap-1">{modelSlot}</div>
                    <div className="flex items-center gap-1">
                        {!recording && contextSlot}
                        {!recording && attachmentsEnabled && <AttachButton />}
                        {voiceControlsVisible && (
                            <VoiceComposerControls
                                status={voice.status}
                                besideSend={submitVisible}
                                onStart={startVoiceMessage}
                                onFinish={() => void finishVoice()}
                                onRetry={retryVoice}
                                onDiscard={discardVoice}
                            />
                        )}
                        {showStop && (
                            <PromptInputButton tooltip={t('stop')} aria-label={t('stop')} onClick={onStop}>
                                <SquareIcon className="size-4" />
                            </PromptInputButton>
                        )}
                        {submitVisible && <PromptInputSubmit status={submitStatus} onStop={busy && !uploading ? onStop : undefined} />}
                    </div>
                </PromptInputFooter>
            </PromptInput>
            <MarkdownEditorDialog
                key={expandSession}
                open={expandOpen}
                onOpenChange={setExpandOpen}
                initialValue={expandValue}
                title={t('editor.title')}
                description={t('editor.description')}
                hint={t('editor.hint')}
                closeLabel={t('editor.cancel')}
                submitLabel={t('editor.send')}
                submitIcon={<SendIcon className="size-4" />}
                submitting={uploading}
                onClose={markdown => {
                    const el = inputRef.current
                    if (!el) return
                    el.value = collapseLinks(markdown)
                    syncComposer()
                }}
                onSubmit={markdown => {
                    const el = inputRef.current
                    if (!el) return
                    el.value = collapseLinks(markdown)
                    syncComposer()
                    setExpandOpen(false)
                    if (gate && !gate.ready) {
                        gate.onBlocked()
                        return
                    }
                    el.form?.requestSubmit()
                }}
            />
        </>
    )
}

function AttachmentChipsClearer({ clearRef }: { clearRef: RefObject<() => void> }) {
    const { clear } = usePromptInputAttachments()
    useEffect(() => {
        clearRef.current = clear
    }, [clearRef, clear])
    return null
}
