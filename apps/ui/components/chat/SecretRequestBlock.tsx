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
    // Only the Chief of Staff's form: the values go to the Vault, which the answer then names.
    toVault?: boolean
    reason?: string
    // Called once the credentials are stored on the engine, with the summary chat message that
    // resumes the run. It only ever carries variable names, never a value.
    onDone: (summary: string) => void
    onSkip: () => void
    onDismiss: () => void
    inline?: boolean
}

export function SecretRequestBlock({ agentId, sessionId, secrets, toVault = false, reason, onDone, onSkip, onDismiss, inline }: SecretRequestBlockProps) {
    const t = useTranslations('chat.secretRequest')
    const errorText = useErrorText()
    const [existingKeys, setExistingKeys] = useState<string[]>([])

    useEffect(() => {
        if (toVault) return
        let cancelled = false
        getAgentKeysAction(agentId).then(result => {
            if (!cancelled) setExistingKeys(result.keys)
        })
        return () => {
            cancelled = true
        }
    }, [agentId, toVault])

    return (
        <SecretRequestBlockBase
            secrets={secrets}
            reason={reason}
            existingKeys={existingKeys}
            toVault={toVault}
            inline={inline}
            onSubmit={async values => {
                if (agentId === FOREMAN_AGENT_ID && sessionId) {
                    const result = await answerForemanSecretRequestAction(sessionId, values)
                    if (!result.success) throw new Error(errorText(result, t('saveFailed')))
                    onDone(serializeSecretResult(secrets, Object.keys(values), result.vaultEntry))
                    return
                }
                const result = sessionId ? await answerSecretRequestAction(sessionId, values) : await updateAgentKeysAction(agentId, { set: values })
                if (!result.success) throw new Error(errorText(result, t('saveFailed')))
                onDone(serializeSecretResult(secrets, Object.keys(values)))
            }}
            onSkip={onSkip}
            onDismiss={onDismiss}
        />
    )
}
