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
        if (decision.always && computerId && always) {
            const result = await allowOnComputerAction(computerId, always.rule === 'folder' ? { kind: 'folder', folder: always.value } : { kind: 'program', program: always.value })
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
            always={
                always && computerId
                    ? { rule: always.value, label: always.rule === 'folder' ? t('alwaysAllowFolder') : t('alwaysAllow', { program: always.value }), warning: always.interpreter ? t('interpreterWarning', { program: always.value }) : always.rule === 'folder' ? t('folderNote', { folder: always.value }) : undefined }
                    : null
            }
            onSubmit={decision => void submit(decision)}
        />
    )
}
