'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { formatAmount, isPaid, priceLabel, type TemplatePricing } from '@rerun/contracts'
import { track } from '@rerun/analytics/client'
import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import { getTemplateAccessAction, startTemplateCheckoutAction } from '@/ee/actions/template-purchase.actions'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { CircleCheckIcon } from '@/lib/icons'
import { useSession } from '@/supabase/session/SessionProvider'

// A paid template, bought inside the conversation between the trial and its install. The payment
// itself is Stripe's page: the card waits for the workspace to own the template, which is what the
// way back from that page lands on, and answering is what starts the build.

export type TemplatePurchaseResult = { ok: true } | { ok: false; reason: 'dismissed' }

export type TemplatePurchaseOffer = { slug: string; title: string; pricing: TemplatePricing }

type PurchaseInput = TemplatePurchaseOffer

const POLL_MS = 2000
// The webhook lands within seconds of the way back; past this the card stays up with its button.
const POLL_ATTEMPTS = 30

function readInput(input: unknown): PurchaseInput | null {
    const value = (input ?? {}) as Partial<PurchaseInput>
    return typeof value.slug === 'string' && typeof value.title === 'string' && value.pricing ? (value as PurchaseInput) : null
}

export function TemplatePurchaseWidget({ input, output, onDone }: { input: unknown; output?: unknown; onDone: (result: TemplatePurchaseResult) => void }) {
    const t = useTranslations('foreman.purchase')
    const errorText = useErrorText()
    const { workspace } = useSession()
    const purchase = readInput(input)
    const bought = (output as TemplatePurchaseResult | null | undefined)?.ok === true
    // A card sealed unanswered is read back from the transcript and can no longer answer: the app
    // puts a fresh one up when the conversation resumes (useForemanScriptedSteps).
    const settled = output !== undefined && output !== null
    const answered = useRef(settled)
    const [owned, setOwned] = useState(false)
    const [opening, setOpening] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const slug = purchase?.slug

    // Answered once, wherever the ownership came from: the poll after the way back from Stripe, or
    // a checkout that answered "already yours".
    useEffect(() => {
        if (!owned || answered.current) return
        answered.current = true
        onDone({ ok: true })
    }, [owned, onDone])

    useEffect(() => {
        if (settled || !slug) return
        let attempts = 0
        let timer: ReturnType<typeof setTimeout> | undefined
        let cancelled = false
        const check = async () => {
            const result = await getTemplateAccessAction(slug).catch(() => null)
            if (cancelled) return
            if (result?.ok && result.access === 'active') return setOwned(true)
            attempts += 1
            if (attempts < POLL_ATTEMPTS) timer = setTimeout(() => void check(), POLL_MS)
        }
        void check()
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [settled, slug])

    if (!purchase || (settled && !bought && !owned)) return null

    if (bought || owned) {
        return (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
                <Icon icon={CircleCheckIcon} className="text-emerald-500" />
                <span>{t('owned', { title: purchase.title })}</span>
            </div>
        )
    }

    const buy = async () => {
        setError(null)
        setOpening(true)
        track('template_purchase_started', { slug: purchase.slug, price_kind: purchase.pricing.model, amount_cents: purchase.pricing.amountCents })
        const result = await startTemplateCheckoutAction(purchase.slug)
        if (!result.ok) {
            setOpening(false)
            setError(errorText(result))
            return
        }
        if (result.outcome.kind === 'checkout') {
            window.location.assign(result.outcome.url)
            return
        }
        setOpening(false)
        setOwned(true)
    }

    return <TemplatePurchaseCard purchase={purchase} billedTo={workspace?.name ?? null} opening={opening} error={error} onBuy={() => void buy()} />
}

export function TemplatePurchaseCard({ purchase, billedTo, opening, error, onBuy }: { purchase: TemplatePurchaseOffer; billedTo: string | null; opening: boolean; error: string | null; onBuy: () => void }) {
    const t = useTranslations('foreman.purchase')
    const tPrice = useTranslations('templates.price')
    const locale = useLocale()
    const price = priceLabel(purchase.pricing, tPrice, locale)
    const recurring = purchase.pricing.model === 'recurring'

    return (
        <div className="mb-2 flex flex-col gap-4 rounded-xl border border-border bg-background p-4">
            <div className="flex flex-col gap-2">
                <Badge size="xs" className="self-start">
                    {recurring ? t('recurring') : t('oneTime')}
                </Badge>
                <h3 className="text-lg font-semibold tracking-tight text-foreground">{purchase.title}</h3>
                <p className="text-sm text-muted-foreground">{billedTo ? t('billedTo', { name: billedTo }) : t('billedToWorkspace')}</p>
            </div>

            <dl className="rounded-lg border border-border bg-muted/20 p-3">
                <dt className="text-xs text-muted-foreground">{t('dueToday')}</dt>
                <dd className="text-2xl font-semibold leading-none text-foreground">
                    {isPaid(purchase.pricing) ? formatAmount(purchase.pricing.amountCents, purchase.pricing.currency, locale) : price}
                    {recurring && <span className="text-xs font-normal text-muted-foreground">{t('perMonth')}</span>}
                </dd>
            </dl>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button size="lg" className="h-11 w-full rounded-xl text-base" onClick={onBuy} disabled={opening}>
                {opening ? t('opening') : recurring ? t('subscribe', { price }) : t('pay', { price })}
            </Button>
        </div>
    )
}
