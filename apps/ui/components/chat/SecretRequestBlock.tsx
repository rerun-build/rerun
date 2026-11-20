'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { answerForemanSecretRequestAction, answerSecretRequestAction, getAgentKeysAction, updateAgentKeysAction } from '@/app/api/_actions/agent.actions'
import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { serializeSecretResult } from '@/lib/chat-hitl'
import { SecretRequestBlock as SecretRequestBlockBase, type SecretRequestItem } from '@rerun/ui/chat'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

type SecretRequestBlockProps = {
    agentId: string
    // The conversation that raised the request: answering it only takes the right to use the coworker.
    // For the Chief of Staff, the caller's own thread with it.
    sessionId: string | null
    secrets: SecretRequestItem[]
    reason?: string
    // Called once the credentials are stored on the engine, with the summary chat message that
    // resumes the run. It only ever carries variable names, never a value.
    onDone: (summary: string) => void
    onSkip: () => void
    onDismiss: () => void
    inline?: boolean
}

export function SecretRequestBlock({ agentId, sessionId, secrets, reason, onDone, onSkip, onDismiss, inline }: SecretRequestBlockProps) {
    const t = useTranslations('chat.secretRequest')
    const errorText = useErrorText()
    const [existingKeys, setExistingKeys] = useState<string[]>([])

    useEffect(() => {
        let cancelled = false
        getAgentKeysAction(agentId).then(result => {
            if (!cancelled) setExistingKeys(result.keys)
        })
        return () => {
            cancelled = true
        }
    }, [agentId])

    return (
        <SecretRequestBlockBase
            secrets={secrets}
            reason={reason}
            existingKeys={existingKeys}
            inline={inline}
            onSubmit={async values => {
                const answer = agentId === FOREMAN_AGENT_ID ? answerForemanSecretRequestAction : answerSecretRequestAction
                const result = sessionId ? await answer(sessionId, values) : await updateAgentKeysAction(agentId, { set: values })
                if (!result.success) throw new Error(errorText(result, t('saveFailed')))
                onDone(serializeSecretResult(secrets, Object.keys(values)))
            }}
            onSkip={onSkip}
            onDismiss={onDismiss}
        />
    )
}
