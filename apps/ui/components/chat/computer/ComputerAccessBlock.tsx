'use client'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { allowOnComputerAction } from '@/app/api/_actions/remote-computers.actions'
import { computerCardFacts, pendingComputerAccess, serializeComputerAccessDecision, type ComputerAccessDecision } from '@/lib/chat-hitl'

import { ComputerAccessCard } from './ComputerAccessCard'

type ComputerAccessBlockProps = { input: Record<string, unknown>; output: unknown; onReply: (text: string) => void }

// The card where it waits in the chat. "Always allow" is written to the computer before the reply
// goes out, so the run the reply starts already follows it. A failed write still answers yes, once,
// and the reply drops the "always": the coworker would otherwise read a rule the computer never got.
export function ComputerAccessBlock({ input, output, onReply }: ComputerAccessBlockProps) {
    const t = useTranslations('chat.computerAccess')
    const request = pendingComputerAccess(input)
    const { computerId, always } = computerCardFacts(output)

    const submit = async (decision: Omit<ComputerAccessDecision, 'computer'>) => {
        let granted: ComputerAccessDecision = { computer: request.computer, ...decision }
        if (decision.always && computerId) {
            const result = await allowOnComputerAction(computerId, { kind: 'program', program: decision.always })
            if (!result.ok) {
                toast.error(t('alwaysFailed'))
                granted = { computer: request.computer, decision: 'approved' }
            }
        }
        onReply(serializeComputerAccessDecision(granted))
    }

    return (
        <ComputerAccessCard
            request={request}
            always={always && computerId ? { rule: always.program, label: t('alwaysAllow', { program: always.program }), warning: always.interpreter ? t('interpreterWarning', { program: always.program }) : undefined } : null}
            onSubmit={decision => void submit(decision)}
        />
    )
}
