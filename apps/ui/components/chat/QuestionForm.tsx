'use client'

import { deleteFileAction } from '@/app/api/_actions/file.actions'
import { deleteForemanFileAction } from '@/app/api/_actions/foreman-file.actions'
import { MessageResponse } from '@/components/ai-elements/message'
import { QuestionAttachmentStack } from '@/components/chat/QuestionAttachmentStack'
import { useFileUploads } from '@/hooks/useFileUploads'
import { useQuestionVoice } from '@/hooks/useQuestionVoice'
import { CHAT_ATTACHMENTS_DIR, uniqueAttachmentName } from '@/lib/chat/attachments-marker'
import { serializeAnswers } from '@/lib/chat-hitl'
import type { UploadTarget } from '@/lib/files/upload-url'
import { MAX_UPLOAD_FILE_BYTES } from '@rerun/contracts'
import { QuestionForm as QuestionFormBase, type QuestionAttachments, type QuestionFormProps as QuestionFormBaseProps, type QuestionItem } from '@rerun/ui/chat'
import type { FileUIPart } from 'ai'
import { nanoid } from 'nanoid'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

const MAX_FILES = 10
const MB = 1024 * 1024

const renderMarkdown = (text: string) => <MessageResponse>{text}</MessageResponse>

type AttachedFile = { uploadId: string; file: FileUIPart & { id: string } }

type QuestionFormProps = Pick<QuestionFormBaseProps, 'ref' | 'textareaRef' | 'textareaProps' | 'inline'> & {
    /** Where a joined file lands. Null when none can reach the coworker: no paperclip then. */
    target: UploadTarget | null
    maxFileSize?: number
    questions: QuestionItem[]
    onSend: (text: string) => void
    onCancel?: () => void
    disabled?: boolean
}

// The upload hook needs a target on every render, including the ones where attachments are off.
const NO_UPLOADS: UploadTarget = { kind: 'shared' }

function toFilePart(file: File): AttachedFile['file'] {
    return {
        id: nanoid(),
        type: 'file',
        filename: file.name,
        mediaType: file.type,
        url: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
    }
}

function revokePreview(entry: AttachedFile) {
    if (entry.file.url) URL.revokeObjectURL(entry.file.url)
}

export function QuestionForm({ ref, target, maxFileSize = MAX_UPLOAD_FILE_BYTES, questions, onSend, onCancel, disabled, inline, textareaRef, textareaProps }: QuestionFormProps) {
    const t = useTranslations('chat.question')
    const tUpload = useTranslations('files.uploadOutcome')
    const uploads = useFileUploads({
        target: target ?? NO_UPLOADS,
        nameFor: uniqueAttachmentName,
        onRejected: message => toast.error(message),
    })
    const voice = useQuestionVoice()
    const [attached, setAttached] = useState<Record<number, AttachedFile[]>>({})

    const attachedRef = useRef(attached)
    useEffect(() => {
        attachedRef.current = attached
    })
    useEffect(() => () => Object.values(attachedRef.current).flat().forEach(revokePreview), [])

    // A file dropped from the answer has already landed on the Box when its upload finished, so it is
    // deleted there too. Best effort, like the composer: chat-uploads/ tolerates an orphan.
    const discard = (entries: AttachedFile[]) => {
        for (const entry of entries) {
            const item = uploads.byId.get(entry.uploadId)
            if (item?.status === 'done' && target) {
                if (target.kind === 'agent') deleteFileAction(target.agentId, item.path).catch(() => {})
                else if (target.kind === 'foreman') deleteForemanFileAction(target.sessionId, item.path).catch(() => {})
            }
            uploads.cancel(entry.uploadId)
            revokePreview(entry)
        }
    }

    const removeFile = (questionIndex: number, fileId: string) => {
        const entry = attached[questionIndex]?.find(e => e.file.id === fileId)
        if (!entry) return
        discard([entry])
        setAttached(prev => ({ ...prev, [questionIndex]: (prev[questionIndex] ?? []).filter(e => e.file.id !== fileId) }))
    }

    const attachments: QuestionAttachments = {
        count: questionIndex => attached[questionIndex]?.length ?? 0,
        onPick: (questionIndex, files) => {
            const room = MAX_FILES - Object.values(attached).flat().length
            if (files.length > room) toast.error(t('tooManyFiles', { max: MAX_FILES, rejected: files.length - Math.max(0, room) }))
            const picked = files.slice(0, Math.max(0, room))
            // Only the sized ones are enqueued, so the ids come back lined up with them. The cap is
            // the target's, which is lower on the hub than on a Box.
            const sized = picked.filter(file => file.size <= maxFileSize)
            const oversized = picked.filter(file => file.size > maxFileSize)
            if (oversized.length > 0) {
                toast.error(tUpload('oversized', { names: oversized.slice(0, 2).map(file => file.name).join(', '), more: Math.max(0, oversized.length - 2), count: oversized.length, limit: maxFileSize / MB }))
            }
            const uploadIds = uploads.enqueue(
                sized.map(file => ({ file, subDir: '' })),
                CHAT_ATTACHMENTS_DIR,
            )
            const added = sized.map((file, index) => ({ uploadId: uploadIds[index], file: toFilePart(file) }))
            setAttached(prev => ({ ...prev, [questionIndex]: [...(prev[questionIndex] ?? []), ...added] }))
        },
        onClear: questionIndex => {
            const entries = attached[questionIndex]
            if (!entries?.length) return
            discard(entries)
            setAttached(prev => ({ ...prev, [questionIndex]: [] }))
        },
        render: questionIndex => {
            const entries = attached[questionIndex] ?? []
            const uploadIdOf = (fileId: string) => entries.find(entry => entry.file.id === fileId)?.uploadId
            return (
                <QuestionAttachmentStack
                    items={entries.map(entry => ({ file: entry.file, upload: uploads.byId.get(entry.uploadId) }))}
                    onRemove={fileId => removeFile(questionIndex, fileId)}
                    onRetry={fileId => {
                        const uploadId = uploadIdOf(fileId)
                        if (uploadId) uploads.retry(uploadId)
                    }}
                />
            )
        },
    }

    const submit = async (answers: { question: string; answers: string[] }[]) => {
        const entries = Object.values(attached).flat()
        const settled = new Map((entries.length > 0 ? await uploads.waitForAll() : []).map(item => [item.id, item]))
        const failed = entries.filter(entry => settled.get(entry.uploadId)?.status !== 'done')
        if (failed.length > 0) {
            toast.error(t('uploadsFailed', { count: failed.length }))
            throw new Error('Attachments not uploaded')
        }
        onSend(
            serializeAnswers(
                answers.map((answer, index) => ({
                    ...answer,
                    attachments: (attached[index] ?? []).map(entry => settled.get(entry.uploadId)!.path),
                })),
            ),
        )
    }

    const cancel = () => {
        discard(Object.values(attached).flat())
        setAttached({})
        onCancel?.()
    }

    return <QuestionFormBase ref={ref} questions={questions} onSubmit={submit} onCancel={onCancel ? cancel : undefined} disabled={disabled} inline={inline} renderText={renderMarkdown} attachments={target ? attachments : undefined} voice={voice} textareaRef={textareaRef} textareaProps={textareaProps} />
}
