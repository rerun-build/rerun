'use client'

import { useState } from 'react'

import type { SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import type { AddableProvider } from '@/lib/engine/ai-sources'

import { ConnectedStep } from './ConnectedStep'
import { KeyConnectStep } from './KeyConnectStep'
import { OfferStep } from './OfferStep'
import { PlanConnectStep } from './PlanConnectStep'

export type SubscriptionOfferStep = 'offer' | SubscriptionProvider | 'opencode' | 'key' | 'connected'

export type KeysResult = { success: boolean; error?: string; reason?: 'no_plan' }

type SubscriptionOfferProps = {
    initialStep?: SubscriptionOfferStep
    initialProvider?: AddableProvider
    onPick?: (provider: AddableProvider) => void
    onKeys: (provider: AddableProvider, keys: Record<string, string>) => Promise<KeysResult>
    onSkip: () => void
    onDone: () => void
    // Whether OpenCode can be offered as a third plan: its flag and the machine's engine both allow it.
    opencodeOffered?: boolean
    claudePlanOffered?: boolean
}

// The left column of the offer. The board beside it is the dialog's aside, and stays put whatever
// step this column is on.
export function SubscriptionOffer({ initialStep = 'offer', initialProvider = 'claude', onPick, onKeys, onSkip, onDone, opencodeOffered = false, claudePlanOffered = true }: SubscriptionOfferProps) {
    const [step, setStep] = useState<SubscriptionOfferStep>(initialStep)
    const [provider, setProvider] = useState<AddableProvider>(initialStep === 'claude' || initialStep === 'codex' ? initialStep : initialProvider)

    const pickPlan = (next: SubscriptionProvider) => {
        onPick?.(next)
        setProvider(next)
        setStep(next)
    }

    const saveKeys = async (next: AddableProvider, keys: Record<string, string>) => {
        const result = await onKeys(next, keys)
        if (result.success) {
            setProvider(next)
            setStep('connected')
        }
        return result
    }

    // A plan's own steps end on the connected state, so they stay on screen once the keys land.
    const savePlanKeys = (next: SubscriptionProvider) => (keys: Record<string, string>) => onKeys(next, keys)

    return (
        <div className="flex h-full min-h-0 flex-col p-6 sm:p-8">
            {step === 'offer' && (
                <OfferStep
                    claudePlanOffered={claudePlanOffered}
                    onPick={pickPlan}
                    onKey={() => setStep('key')}
                    onOpencode={
                        opencodeOffered
                            ? () => {
                                  onPick?.('opencode')
                                  setStep('opencode')
                              }
                            : undefined
                    }
                    onSkip={onSkip}
                />
            )}
            {(step === 'claude' || step === 'codex') && <PlanConnectStep provider={step} onBack={() => setStep('offer')} onSkip={onSkip} onKeys={savePlanKeys(step)} onDone={onDone} />}
            {step === 'key' && <KeyConnectStep onPick={onPick} onBack={() => setStep('offer')} onSkip={onSkip} onKeys={saveKeys} />}
            {step === 'opencode' && <KeyConnectStep only="opencode" onBack={() => setStep('offer')} onSkip={onSkip} onKeys={saveKeys} />}
            {step === 'connected' && <ConnectedStep provider={provider} onDone={onDone} />}
        </div>
    )
}
