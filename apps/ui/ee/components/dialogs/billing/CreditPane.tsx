'use client'

import { CREDIT_PACK_PRICE_CENTS, CREDITS_PER_PACK, MAX_CREDIT_PACKS_PER_PURCHASE } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { quoteCreditPurchaseAction } from '@/ee/actions/billing.actions'
import { runCreditPurchase } from '@/ee/lib/billing/plan-payment'
import type { CreditQuote } from '@/ee/services/credit-purchase.service'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useErrorText } from '@/hooks/useErrorText'
import { MinusIcon, PlusIcon } from '@/lib/icons'

import { CardOnFile, PayFooter, RightTitle, SummaryRows, TermsConsent, usd } from './parts'

const QUOTE_DEBOUNCE_MS = 250

// What Stripe would charge today for a number of packs. `loading` until the answer for that very
// number is in; `quote` keeps the last answer meanwhile, so the card on file does not blink at every
// step. A failed quote reads as none: the pane falls back on the list price and on Checkout.
function useCreditQuote(packs: number): { quote: CreditQuote | null; loading: boolean; settled: boolean } {
    const [answer, setAnswer] = useState<{ packs: number; quote: CreditQuote | null } | null>(null)

    useEffect(() => {
        let cancelled = false
        const timer = setTimeout(async () => {
            const result = await quoteCreditPurchaseAction(packs)
            if (!cancelled) setAnswer({ packs, quote: result.ok ? result : null })
        }, QUOTE_DEBOUNCE_MS)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [packs])

    return { quote: answer?.quote ?? null, loading: answer?.packs !== packs, settled: !!answer }
}

export type CreditPurchased = { title: string; body: string }

// Rerun credit bought once: the packs never expire. With no card on file the button opens a Stripe
// Checkout page, and the credit lands when the payment does.
export function CreditPane({ onBack, onDone }: { onBack?: () => void; onDone: (success: CreditPurchased) => void }) {
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const [packs, setPacks] = useState(1)
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { quote, loading, settled } = useCreditQuote(packs)
    const onCheckout = settled && !quote?.card
    // Stripe's Checkout page collects the consent itself.
    const needsConsent = settled && !onCheckout && !accepted
    const listPrice = packs * CREDIT_PACK_PRICE_CENTS

    const buy = async () => {
        setSubmitting(true)
        setError(null)
        const result = await runCreditPurchase(packs)
        if (!result.ok) {
            setSubmitting(false)
            return setError(errorText(result))
        }
        if (result.kind === 'checkout') return window.location.assign(result.url)
        setSubmitting(false)
        onDone({ title: t('plan.credit.addedTitle'), body: t('plan.credit.addedBody', { count: packs * CREDITS_PER_PACK }) })
    }

    const dueToday = loading ? <Skeleton className="inline-block h-4 w-14" /> : usd(quote?.dueTodayCents ?? listPrice)

    return (
        <>
            <RightTitle onBack={onBack}>{t('plan.credit.title')}</RightTitle>
            <p className="mt-2 text-sm text-muted-foreground">{t('plan.credit.eachPack', { count: CREDITS_PER_PACK, price: usd(CREDIT_PACK_PRICE_CENTS) })}</p>
            <div className="mt-6 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3 rounded-xl bg-background/60 px-4 py-3 ring-1 ring-border">
                    <div className="min-w-0">
                        <p className="text-sm font-medium">{t('plan.credit.packs', { count: packs })}</p>
                        <p className="text-xs text-muted-foreground">{t('plan.credit.packCredits', { count: packs * CREDITS_PER_PACK })}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button variant="outline" size="icon-sm" aria-label={t('plan.credit.lessAria')} onClick={() => setPacks(value => Math.max(1, value - 1))} disabled={packs <= 1}>
                            <MinusIcon />
                        </Button>
                        <Button variant="outline" size="icon-sm" aria-label={t('plan.credit.moreAria')} onClick={() => setPacks(value => Math.min(MAX_CREDIT_PACKS_PER_PURCHASE, value + 1))} disabled={packs >= MAX_CREDIT_PACKS_PER_PURCHASE}>
                            <PlusIcon />
                        </Button>
                    </div>
                </div>
                <SummaryRows rows={[{ label: quote?.taxIncluded ? t('plan.change.dueTodayTaxIncluded') : t('plan.credit.dueBeforeTax'), value: dueToday, strong: true }]} />
                {quote?.card && <CardOnFile card={quote.card} />}
            </div>
            <PayFooter cta={onCheckout ? t('plan.credit.payOnStripe') : t('plan.credit.buy')} footnote={onCheckout ? t('plan.credit.checkoutFootnote') : t('plan.credit.chargedOnce')} onClick={() => void buy()} loading={submitting} disabled={needsConsent || loading} disabledReason={needsConsent ? t('plan.acceptTerms') : undefined} error={error}>
                {settled && !onCheckout && <TermsConsent checked={accepted} onChange={setAccepted} />}
            </PayFooter>
        </>
    )
}
