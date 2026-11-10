'use client'

import { deleteFileAction } from '@/app/api/_actions/file.actions'
import { MessageResponse } from '@/components/ai-elements/message'
import { QuestionAttachmentStack } from '@/components/chat/QuestionAttachmentStack'
import { useFileUploads } from '@/hooks/useFileUploads'
import { CHAT_ATTACHMENTS_DIR, uniqueAttachmentName } from '@/lib/chat/attachments-marker'
import { serializeAnswers } from '@/lib/chat-hitl'
import { MAX_UPLOAD_FILE_BYTES } from '@rerun/contracts'
import { QuestionForm as QuestionFormBase, type QuestionAttachments, type QuestionFormProps as QuestionFormBaseProps, type QuestionItem } from '@rerun/ui/chat'
import type { FileUIPart } from 'ai'
import { nanoid } from 'nanoid'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

const MAX_FILES = 10

const renderMarkdown = (text: string) => <MessageResponse>{text}</MessageResponse>

type AttachedFile = { uploadId: string; file: FileUIPart & { id: string } }

type QuestionFormProps = Pick<QuestionFormBaseProps, 'ref' | 'textareaRef' | 'textareaProps' | 'inline'> & {
    agentId: string
    questions: QuestionItem[]
    onSend: (text: string) => void
    onCancel: () => void
    disabled?: boolean
}

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

export function QuestionForm({ ref, agentId, questions, onSend, onCancel, disabled, inline, textareaRef, textareaProps }: QuestionFormProps) {
    const t = useTranslations('chat.question')
    const uploads = useFileUploads({
        target: useMemo(() => ({ kind: 'agent', agentId }) as const, [agentId]),
        nameFor: uniqueAttachmentName,
        onRejected: message => toast.error(message),
    })
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
            if (item?.status === 'done') deleteFileAction(agentId, item.path).catch(() => {})
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
            // enqueue skips oversized files (and reports them), so its ids line up with the sized ones.
            const sized = picked.filter(file => file.size <= MAX_UPLOAD_FILE_BYTES)
            const uploadIds = uploads.enqueue(
                picked.map(file => ({ file, subDir: '' })),
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
        onCancel()
    }

    return <QuestionFormBase ref={ref} questions={questions} onSubmit={submit} onCancel={cancel} disabled={disabled} inline={inline} renderText={renderMarkdown} attachments={attachments} textareaRef={textareaRef} textareaProps={textareaProps} />
}
