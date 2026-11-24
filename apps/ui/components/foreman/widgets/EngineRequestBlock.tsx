'use client'

import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { allowForemanPaidDataAction } from '@/app/api/_actions/agent.actions'
import { ActionApprovalBlock } from '@/components/chat/ActionApprovalBlock'
import { ComputerAccessBlock } from '@/components/chat/computer/ComputerAccessBlock'
import { FeatureRequestBlock } from '@/components/chat/feature-request/FeatureRequestBlock'
import { McpSignInBlock } from '@/components/chat/McpSignInBlock'
import { SecretRequestBlock } from '@/components/chat/SecretRequestBlock'
import { SpendRequestBlock } from '@/components/chat/spend/SpendRequestBlock'
import { ServiceSuggestionBlock } from '@/components/services/ServiceSuggestionBlock'
import { HITL_CANCELLED, pendingApprovals, pendingFeatureRequest, pendingMcpSignIn, pendingSecrets, pendingSecretVault, serializeApprovalDecisions, serializeSpendDecision, type SpendDecision } from '@/lib/chat-hitl'
import type { UploadTarget } from '@/lib/files/upload-url'
import type { PendingWidget } from '@/lib/foreman/pending-widget'
import { useForemanStore } from '@/stores/foreman.store'

import { EngineQuestionWidget } from './EngineQuestionWidget'

type EngineRequestBlockProps = {
    request: PendingWidget
    answerAttachments: { target: UploadTarget; maxFileSize: number } | null
    onAnswer: (text: string) => void
    onDismiss?: () => void
}

/**
 * What the Chief of Staff's run stopped on, drawn after its last message with the very blocks a
 * coworker's chat draws, each answered by the message that resumes the run. The browser takeover is
 * not one of them: it is the screen the column shows.
 */
export function EngineRequestBlock({ request, answerAttachments, onAnswer, onDismiss }: EngineRequestBlockProps) {
    const t = useTranslations('chat.agentChat')
    const conversationId = useForemanStore(state => state.sessionId)
    const input = (request.input ?? {}) as Record<string, unknown>

    // "Always allow" is written before the reply goes out, as in a coworker's chat: the run the reply
    // starts already reads it, and a failed write keeps the approval to its estimate.
    async function submitSpend(decision: SpendDecision) {
        let granted = decision
        if (decision.always) {
            const result = await allowForemanPaidDataAction()
            if (!result.success) {
                toast.error(t('alwaysAllowFailed'))
                granted = { purpose: decision.purpose, decision: 'approved' }
            }
        }
        onAnswer(serializeSpendDecision(granted))
    }

    switch (request.toolName) {
        case 'ask_user':
            return <EngineQuestionWidget input={request.input} target={answerAttachments?.target ?? null} maxFileSize={answerAttachments?.maxFileSize} onAnswer={onAnswer} onDismiss={onDismiss} />
        case 'request_computer_access':
            return <ComputerAccessBlock input={input} output={request.output} onReply={onAnswer} />
        case 'request_secret':
            return (
                <SecretRequestBlock
                    inline
                    agentId={FOREMAN_AGENT_ID}
                    sessionId={conversationId}
                    secrets={pendingSecrets(input)}
                    toVault={!!pendingSecretVault(input)}
                    reason={typeof input.reason === 'string' ? input.reason : undefined}
                    onDone={onAnswer}
                    onSkip={() => onAnswer(HITL_CANCELLED.secret)}
                    onDismiss={() => onDismiss?.()}
                />
            )
        case 'suggest_service':
            return <ServiceSuggestionBlock inline agentId={FOREMAN_AGENT_ID} services={(Array.isArray(input.services) ? input.services : []) as { slug: string; reason?: string }[]} onDone={onAnswer} />
        case 'request_mcp_sign_in':
            return <McpSignInBlock inline agentId={FOREMAN_AGENT_ID} {...pendingMcpSignIn(input)} onDone={onAnswer} onSkip={() => onAnswer(HITL_CANCELLED.mcp)} />
        case 'request_spend':
            return <SpendRequestBlock input={input} output={request.output} onSubmit={decision => void submitSpend(decision)} />
        case 'request_feature':
            return <FeatureRequestBlock request={pendingFeatureRequest(input)} toolCallId={request.toolCallId} onSent={onAnswer} onSkip={() => onAnswer(HITL_CANCELLED.feature)} />
        case 'request_takeover':
            return null
        default:
            return <ActionApprovalBlock inline approvals={pendingApprovals(input)} onSubmit={decisions => onAnswer(serializeApprovalDecisions(decisions))} />
    }
}
