'use client'

import { pendingSpend, readSpendQuote, type SpendDecision } from '@rerun/contracts'

import { useRerunCredit } from '@/hooks/useRerunCredit'
import { useBillingStore } from '@/stores/billing.store'
import { useSession } from '@/supabase/session/SessionProvider'

import { SpendCard } from './SpendCard'

type SpendRequestBlockProps = {
    input: Record<string, unknown>
    output: unknown
    onSubmit: (decision: SpendDecision) => void
}

// The quote is what the hub priced when the coworker asked; the credit left is read live, so the
// card turns from "Add credits" to the approve buttons as soon as the workspace is topped up.
export function SpendRequestBlock({ input, output, onSubmit }: SpendRequestBlockProps) {
    const { workspace } = useSession()
    const { usedMicros, budgetMicros } = useRerunCredit()
    const openBilling = useBillingStore(s => s.openBilling)
    const priced = readSpendQuote(output)
    if (!priced) return null

    const request = pendingSpend(input)
    const quote = { ...priced, creditLeftMicros: Math.max(budgetMicros - usedMicros, 0) }
    // Credit packs are not sold on a trial: what opens more credit there is the plan itself.
    const addCredits = () => (workspace?.subscription_status === 'trialing' ? openBilling(undefined, 'spend_short_trial') : openBilling('credit_pack', 'spend_short'))

    return <SpendCard request={request} quote={quote} onSubmit={decision => onSubmit({ purpose: request.purpose, ...decision })} onAddCredits={addCredits} />
}
