'use client'

import { longDate, shortDate } from '@rerun/i18n/format'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import type { SavedCard } from '@/ee/services/billing.service'
import { CreditCardIcon, InfoIcon, MinusIcon, PlusIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { CountFlow } from '../parts'

// "Dec 26" this year, "Nov 26, 2027" past it: a yearly renewal reads as the day it is.
export function billingDate(date: Date | string, locale: string): string {
    return new Date(date).getFullYear() === new Date().getFullYear() ? shortDate(date, locale) : longDate(date, locale)
}

export const TILE_FRAME = 'rounded-xl bg-background/60 ring-1 ring-border'

// A sub-page's body. Its header is the dialog's own.
export function Panel({ children }: { children: ReactNode }) {
    return <div className="flex flex-1 flex-col gap-5">{children}</div>
}

export function Explain({ children }: { children: ReactNode }) {
    return <p className="text-sm text-muted-foreground">{children}</p>
}

export function Note({ children }: { children: ReactNode }) {
    return (
        <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            <InfoIcon className="mt-px size-3.5 shrink-0" />
            <span>{children}</span>
        </p>
    )
}

export function Stepper({ value, min, max, onChange, lessLabel, moreLabel, lessReason, moreReason }: { value: number; min: number; max: number; onChange: (next: number) => void; lessLabel: string; moreLabel: string; lessReason?: string; moreReason?: string }) {
    return (
        <div className="flex shrink-0 items-center gap-1">
            <TooltipDisabledReason reason={value <= min ? lessReason : undefined}>
                <Button size="icon-sm" variant="outline" aria-label={lessLabel} disabled={value <= min} onClick={() => onChange(value - 1)}>
                    <MinusIcon />
                </Button>
            </TooltipDisabledReason>
            <span className="w-7 text-center text-sm tabular-nums">
                <CountFlow value={value} />
            </span>
            <TooltipDisabledReason reason={value >= max ? moreReason : undefined}>
                <Button size="icon-sm" variant="outline" aria-label={moreLabel} disabled={value >= max} onClick={() => onChange(value + 1)}>
                    <PlusIcon />
                </Button>
            </TooltipDisabledReason>
        </div>
    )
}

// The networks' own names, never translated.
const CARD_BRAND_NAMES: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', jcb: 'JCB', diners: 'Diners Club', unionpay: 'UnionPay' }

export function cardBrandName(brand: string): string {
    return CARD_BRAND_NAMES[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1)
}

// A card's network as a small white card with its wordmark, the way payment forms show it.
export function CardBrand({ brand, className }: { brand: string | null; className?: string }) {
    return (
        <span aria-hidden className={cn('flex h-7 w-11 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-black/10', className)}>
            {brand === 'visa' ? (
                <span className="text-[13px] font-black tracking-tight text-[#1a1f71] italic">VISA</span>
            ) : brand === 'mastercard' ? (
                <span className="flex">
                    <span className="size-4 rounded-full bg-[#eb001b]" />
                    <span className="-ms-1.5 size-4 rounded-full bg-[#f79e1b] mix-blend-multiply" />
                </span>
            ) : brand === 'amex' ? (
                <span className="rounded-sm bg-[#006fcf] px-1 text-[9px] font-black tracking-tight text-white">AMEX</span>
            ) : (
                <CreditCardIcon className="size-4 text-neutral-500" />
            )}
        </span>
    )
}

export function cardExpiry(card: Pick<SavedCard, 'expMonth' | 'expYear'>): string {
    return `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
}

export function CardLine({ card, action, onAction }: { card: SavedCard | null; action?: string; onAction?: () => void }) {
    const t = useTranslations('billing.tiles.card')
    return (
        <div className={cn('flex items-center gap-3 px-4 py-3', TILE_FRAME)}>
            <CardBrand brand={card?.brand ?? null} />
            <div className="min-w-0 flex-1">
                {card ? (
                    <>
                        <p className="truncate text-sm font-medium">{t('number', { network: cardBrandName(card.brand), last4: card.last4 })}</p>
                        <p className="text-xs text-muted-foreground">{t('expires', { date: cardExpiry(card) })}</p>
                    </>
                ) : (
                    <p className="text-sm text-muted-foreground">{t('none')}</p>
                )}
            </div>
            {action && onAction && (
                <Button size="sm" variant="ghost" onClick={onAction}>
                    {action}
                </Button>
            )}
        </div>
    )
}
