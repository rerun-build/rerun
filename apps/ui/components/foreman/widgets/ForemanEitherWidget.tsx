'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { asStringArray } from '@/lib/mcp/args'
import { cn } from '@/lib/utils'
import { QuestionRecap } from './ForemanQuestionWidget'
import { readQuestionOutput, type QuestionAnswer } from './question-answer'

// The interview's question: two answers, one click. It answers in the same shape as ask_choice, so
// everything that reads an answered question off the transcript reads this one too.

type ForemanEitherWidgetProps = {
    input: unknown
    output?: unknown
    onAnswer: (answer: QuestionAnswer) => void
}

export function ForemanEitherWidget({ input, output, onAnswer }: ForemanEitherWidgetProps) {
    const t = useTranslations('foreman.question')
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
    const title = typeof args.title === 'string' ? args.title : t('fallback')
    const description = typeof args.description === 'string' ? args.description : ''
    const options = asStringArray(args.options).slice(0, 2)

    const answered = readQuestionOutput(output)
    if (answered) return <QuestionRecap question={title} answer={answered} />

    return (
        <div className={cn('mb-2 flex flex-col gap-3 p-4', PANEL_CARD)}>
            <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium">{title}</p>
                {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {options.map(option => (
                    <Button key={option} size="lg" className="h-auto min-h-9 py-1.5 whitespace-normal" onClick={() => onAnswer({ answered: true, question: title, answers: [option] })}>
                        {option}
                    </Button>
                ))}
            </div>
            {/* The composer is gone while the card waits: without a way out, someone neither answer
                fits has nothing left to click. */}
            <Button size="sm" variant="ghost" className="self-center text-muted-foreground" onClick={() => onAnswer({ answered: false, reason: 'neither' })}>
                {t('neither')}
            </Button>
        </div>
    )
}
