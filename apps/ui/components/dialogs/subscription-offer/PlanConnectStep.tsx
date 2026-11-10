'use client'

import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import type { SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import { ChatGptPlanSteps } from '@/components/connections/plan-connect/ChatGptPlanSteps'
import { ClaudePlanSteps } from '@/components/connections/plan-connect/ClaudePlanSteps'
import type { TrackStep } from '@/components/connections/plan-connect/ForemanTrack'
import { LetsGoButton } from '@/components/connections/plan-connect/step-bits'
import { useClaudeOAuth } from '@/components/connections/use-claude-oauth'
import { useCodexDeviceAuth } from '@/components/connections/use-codex-device-auth'

import { DeclineButton, OfferFooter } from './offer-footer'
import { PLANS } from './offer-plans'
import type { KeysResult } from './SubscriptionOffer'

type PlanConnectStepProps = {
    provider: SubscriptionProvider
    onBack: () => void
    onSkip: () => void
    onKeys: (keys: Record<string, string>) => Promise<KeysResult>
    onDone: () => void
}

export function PlanConnectStep({ provider, ...props }: PlanConnectStepProps) {
    return provider === 'claude' ? <ClaudePlanConnect {...props} /> : <ChatGptPlanConnect {...props} />
}

type ProviderConnectProps = Omit<PlanConnectStepProps, 'provider'>

function ClaudePlanConnect({ onBack, onSkip, onKeys, onDone }: ProviderConnectProps) {
    const t = useTranslations('dialogs.subscriptionOffer.plan')
    const oauth = useClaudeOAuth(onKeys, 'subscription_offer')
    return (
        <PlanConnectFrame provider="claude" connected={oauth.phase === 'connected'} onBack={onBack} onSkip={onSkip}>
            <ClaudePlanSteps oauth={oauth} lastStep={letsGo('claude', onDone, t)} />
        </PlanConnectFrame>
    )
}

function ChatGptPlanConnect({ onBack, onSkip, onKeys, onDone }: ProviderConnectProps) {
    const t = useTranslations('dialogs.subscriptionOffer.plan')
    const auth = useCodexDeviceAuth(onKeys, 'subscription_offer')
    return (
        <PlanConnectFrame provider="codex" connected={auth.phase === 'connected'} onBack={onBack} onSkip={onSkip}>
            <ChatGptPlanSteps auth={auth} lastStep={letsGo('codex', onDone, t)} />
        </PlanConnectFrame>
    )
}

type PlanTranslator = ReturnType<typeof useTranslations<'dialogs.subscriptionOffer.plan'>>

function letsGo(provider: SubscriptionProvider, onDone: () => void, t: PlanTranslator) {
    const { name } = PLANS[provider]
    return (linked: boolean): TrackStep => ({
        title: linked ? t('linked', { name }) : t('switching', { name }),
        body: <LetsGoButton disabled={!linked} onClick={onDone} />,
    })
}

type PlanConnectFrameProps = { provider: SubscriptionProvider; connected: boolean; onBack: () => void; onSkip: () => void; children: ReactNode }

// Once connected, "Let's go" in the last step is the way on: going back or staying on Rerun credits
// no longer means anything, so the footer goes.
function PlanConnectFrame({ provider, connected, onBack, onSkip, children }: PlanConnectFrameProps) {
    const t = useTranslations('dialogs.subscriptionOffer.plan')
    return (
        <>
            <ScrollFade className="-mx-1 -mt-1 min-h-0 flex-1 px-1 pt-1 pb-6">
                <div className="flex flex-col gap-6">
                    <h2 className="text-lg font-semibold">{t('title', { name: PLANS[provider].name })}</h2>
                    {children}
                </div>
            </ScrollFade>

            {!connected && (
                <OfferFooter onBack={onBack}>
                    <DeclineButton onClick={onSkip} />
                </OfferFooter>
            )}
        </>
    )
}
