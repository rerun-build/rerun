'use client'

import { QuestionForm } from '@/components/chat/QuestionForm'
import { pendingQuestions } from '@/lib/chat-hitl'
import type { UploadTarget } from '@/lib/files/upload-url'

export function EngineQuestionWidget({ input, target, maxFileSize, onAnswer, onDismiss }: { input: unknown; target: UploadTarget | null; maxFileSize?: number; onAnswer: (text: string) => void; onDismiss?: () => void }) {
    return <QuestionForm inline target={target} maxFileSize={maxFileSize} questions={pendingQuestions((input ?? {}) as Record<string, unknown>)} onSend={onAnswer} onCancel={onDismiss} />
}
