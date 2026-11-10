'use client'

import { QuestionForm } from '@rerun/ui/chat'
import { useTranslations } from 'next-intl'

import { MessageResponse } from '@/components/ai-elements/message'
import { asStringArray } from '@/lib/mcp/args'
import { readQuestionOutput, type QuestionAnswer } from './question-answer'

// ask_choice and ask_input are the same widget with and without buttons: QuestionForm already falls
// back to a free field when it is given no option, and it is what the engine agents ask through, so
// a question from the foreman reads exactly like a question from an agent.

type ForemanQuestionWidgetProps = {
    input: unknown
    output?: unknown
    onAnswer: (answer: QuestionAnswer) => void
    onDismiss?: () => void
}

const renderMarkdown = (text: string) => <MessageResponse>{text}</MessageResponse>

function recapText(answer: QuestionAnswer, t: ReturnType<typeof useTranslations<'foreman.question'>>): string {
    if (answer.answered) return answer.answers.length ? answer.answers.join(', ') : t('skipped')
    if (answer.reason === 'neither') return t('neither')
    if (answer.reason === 'typed') return t('typed')
    return t('skipped')
}

// A reload rebuilds the widget from the transcript, where the answer already sits. Showing the form
// again would invite a second answer nothing is waiting for.
export function QuestionRecap({ question, answer }: { question: string; answer: QuestionAnswer }) {
    const t = useTranslations('foreman.question')
    const text = recapText(answer, t)
    return (
        <div className="mb-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
            <p className="text-muted-foreground text-xs">{question}</p>
            <p className="text-foreground">{text}</p>
        </div>
    )
}

export function ForemanQuestionWidget({ input, output, onAnswer, onDismiss }: ForemanQuestionWidgetProps) {
    const t = useTranslations('foreman.question')
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    const question = typeof args.question === 'string' ? args.question : t('fallback')
    const options = asStringArray(args.options).map(label => ({ label }))

    const answered = readQuestionOutput(output)
    if (answered) return <QuestionRecap question={question} answer={answered} />

    return <QuestionForm inline questions={[{ question, options, multiple: args.multiple === true }]} renderText={renderMarkdown} onSubmit={answers => onAnswer({ answered: true, question, answers: answers[0]?.answers ?? [] })} onCancel={onDismiss} />
}
