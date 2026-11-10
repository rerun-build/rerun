'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { track } from '@rerun/analytics/client'
import { RERUN_CONNECTION_ID } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { readLeadInstallAction, startLeadSetupAction } from '@/app/api/_actions/foreman-lead.actions'
import { listAiConnectionsAction } from '@/app/api/_actions/workspace-connection.actions'
import { ForemanOutcomeRow } from '@/components/foreman/widgets/ForemanOutcomeRow'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { invalidateAgentContext } from '@/hooks/useAgentContext'
import { BASE_PLAN_SLUG } from '@rerun/cloud/billing'
import { CircleCheckIcon } from '@/lib/icons'
import type { ForemanNextStep } from '@/lib/foreman/next-steps'
import { AGENT_LIMIT_TRIGGER, useBillingStore } from '@/stores/billing.store'
import { useBoardStore } from '@/stores/board.store'
import { useForemanStore } from '@/stores/foreman.store'
import { useSubscriptionOfferStore } from '@/stores/subscription-offer.store'

type StartLeadStep = Extract<ForemanNextStep, { kind: 'start_lead' }>
type CheckoutStep = Extract<ForemanNextStep, { kind: 'checkout' }>

function openLeadChat(agentId: string, conversationId: string, runId: string | null) {
    const board = useBoardStore.getState()
    board.openAgentTab(agentId, 'chat')
    board.setPendingOpenSession({ agentId, sessionId: conversationId, runId })
    useForemanStore.getState().close()
}

/** Starts the lead's install and opens its chat already attached to the run. */
export async function startLeadInstall(agentId: string, installFailedText: string, errorText: ReturnType<typeof useErrorText>): Promise<boolean> {
    track('agent_install_started', { agent_id: agentId })
    // A run picks its connection the moment it starts and keeps it to the end: started beside the
    // offer, the first install would always bill Rerun credits, whatever plan gets connected.
    const { connections } = await listAiConnectionsAction()
    const hasOwnConnection = connections.some(connection => connection.id !== RERUN_CONNECTION_ID && connection.connected)
    if (!hasOwnConnection) await useSubscriptionOfferStore.getState().offer(agentId)
    const result = await startLeadSetupAction(agentId)
    if (!result.ok) {
        if (result.inactive) useBillingStore.getState().openBilling(undefined, AGENT_LIMIT_TRIGGER)
        else toast.error(installFailedText, { description: errorText(result) })
        return false
    }
    useForemanStore.getState().setStartedLead({ agentId, conversationId: result.conversationId })
    // The agent's own tabs read whether its install is under way from the engine: they learn it now
    // rather than offering to start it again beside the chat this opens.
    invalidateAgentContext(agentId)
    openLeadChat(agentId, result.conversationId, result.runId)
    return true
}

// The run is started here rather than from the agent's own install button so the chat opens already
// attached to it, and the Foreman gets out of the way the moment it does. Once started, the button
// gives way to a row that leads back to that chat: the build stays the last thing said, so nothing
// else would take it off a column reopened later.
function StartLeadButton({ step }: { step: StartLeadStep }) {
    const t = useTranslations('foreman.nextSteps')
    const errorText = useErrorText()
    const [starting, setStarting] = useState(false)
    const [checkedAgentId, setCheckedAgentId] = useState<string | null>(null)
    const startedLead = useForemanStore(state => state.startedLead)
    const started = startedLead?.agentId === step.agentId ? startedLead : null

    useEffect(() => {
        let cancelled = false
        void readLeadInstallAction(step.agentId).then(({ conversationId }) => {
            if (cancelled) return
            if (conversationId) useForemanStore.getState().setStartedLead({ agentId: step.agentId, conversationId })
            setCheckedAgentId(step.agentId)
        })
        return () => {
            cancelled = true
        }
    }, [step.agentId])

    const start = async () => {
        track('onboarding_next_step_clicked', { step: step.kind })
        setStarting(true)
        await startLeadInstall(step.agentId, t('installFailed'), errorText)
        setStarting(false)
    }

    if (started) {
        return (
            <ForemanOutcomeRow
                icon={CircleCheckIcon}
                tone="text-emerald-500"
                text={step.startedLabel}
                action={
                    <Button variant="secondary" size="sm" onClick={() => openLeadChat(started.agentId, started.conversationId, null)}>
                        {t('openChat')}
                    </Button>
                }
            />
        )
    }

    if (checkedAgentId !== step.agentId) return <Skeleton className="h-10 w-full rounded-md" />

    return (
        <Button size="lg" className="w-full" disabled={starting} onClick={() => void start()}>
            {starting ? t('starting') : step.label}
        </Button>
    )
}

function openBilling() {
    track('onboarding_next_step_clicked', { step: 'billing' })
    useBillingStore.getState().openBilling(undefined, 'foreman')
}

// The same card form the folded trial row reopens. The build follows on its own once the workspace
// turns entitled (useForemanScriptedSteps).
function openCheckout(step: CheckoutStep) {
    track('onboarding_next_step_clicked', { step: step.kind })
    track('checkout_started', { plan: BASE_PLAN_SLUG, source: 'foreman' })
    useBillingStore.getState().openBilling(undefined, step.trigger)
}

export function ForemanNextSteps({ steps }: { steps: ForemanNextStep[] }) {
    const [step] = steps
    if (!step) return null
    if (step.kind === 'start_lead') return <StartLeadButton step={step} />
    if (step.kind === 'checkout') {
        return (
            <Button size="lg" className="w-full" onClick={() => openCheckout(step)}>
                {step.label}
            </Button>
        )
    }

    return (
        <Button size="lg" className="w-full" onClick={openBilling}>
            {step.label}
        </Button>
    )
}
