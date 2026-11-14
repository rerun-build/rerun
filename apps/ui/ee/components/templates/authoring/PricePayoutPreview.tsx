'use client'

import { creatorNetCents, formatAmount, marketplaceFeeLabel, rerunFeeCents, type TemplatePricingModel } from '@rerun/contracts'
import { Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

export function PricePayoutPreview({ model, amountCents, currency }: { model: TemplatePricingModel; amountCents: number; currency: string }) {
    const t = useTranslations('templates.pricing.payout')
    const recurring = model === 'recurring' ? 'true' : 'false'

    return (
        <div className="relative flex flex-col gap-2.5 overflow-hidden rounded-lg border border-border/60 bg-muted/30 p-3">
            <Stripes />
            <Row label={t('yourPrice', { recurring })} value={formatAmount(amountCents, currency)} />
            <Row label={t('fee', { fee: marketplaceFeeLabel(currency) })} value={`-${formatAmount(rerunFeeCents(amountCents), currency)}`} />
            <Row label={t('earn', { recurring })} value={formatAmount(creatorNetCents(amountCents), currency)} emphasis />
            <p className="relative text-[11px] text-muted-foreground">{t('vat')}</p>
        </div>
    )
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
    return (
        <div className="relative flex items-center justify-between gap-4 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className={emphasis ? 'whitespace-nowrap font-medium text-foreground' : 'whitespace-nowrap text-muted-foreground'}>{value}</span>
        </div>
    )
}
