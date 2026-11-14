'use client'

import { BillingAddressElement, CheckoutElementsProvider, ExpressCheckoutElement, PaymentElement, TaxIdElement, useCheckout } from '@stripe/react-stripe-js/checkout'
import type { Appearance, StripeCheckoutExpressCheckoutElementOptions, StripeExpressCheckoutElementConfirmEvent } from '@stripe/stripe-js'
import { useTranslations } from 'next-intl'
import { useTheme } from 'next-themes'
import { useState, type ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { stripeBrowser } from '@/ee/lib/billing/stripe-client'
import { cn } from '@/lib/utils'

import { Notice, PromoCodeField, usd } from './parts'

const TAX_ID_OPTIONS = { visibility: 'auto' } as const

function appearanceFor(theme: string | undefined): Appearance {
    return {
        theme: theme === 'light' ? 'stripe' : 'night',
        variables: { borderRadius: '8px', fontSizeBase: '14px', spacingUnit: '3px' },
    }
}

export function StripeCheckoutProvider({ clientSecret, children }: { clientSecret: string; children: ReactNode }) {
    const { resolvedTheme } = useTheme()
    const [options] = useState(() => ({ clientSecret, elementsOptions: { appearance: appearanceFor(resolvedTheme) } }))
    return (
        <CheckoutElementsProvider stripe={stripeBrowser()} options={options}>
            {children}
        </CheckoutElementsProvider>
    )
}

export function StripePaymentFieldsSkeleton() {
    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
            </div>
            <Skeleton className="h-10 w-full" />
            <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-5 w-48" />
        </div>
    )
}

const WALLET_OPTIONS: StripeCheckoutExpressCheckoutElementOptions = {
    buttonHeight: 44,
    buttonTheme: undefined,
    buttonType: { applePay: 'subscribe', googlePay: 'subscribe' },
    layout: undefined,
    paymentMethodOrder: ['apple_pay', 'google_pay'],
    paymentMethods: { applePay: 'always', googlePay: 'always', link: 'never', paypal: 'never', amazonPay: 'never', klarna: 'never' },
}

export type WalletPayment = {
    onConfirm: (event: StripeExpressCheckoutElementConfirmEvent) => void
    disabledReason?: string
}

export function StripePaymentFields({ wallet }: { wallet?: WalletPayment }) {
    const t = useTranslations('billing.stripe')
    const checkout = useCheckout()
    const [walletsShown, setWalletsShown] = useState(false)
    if (checkout.type === 'loading') return <StripePaymentFieldsSkeleton />
    if (checkout.type === 'error') return <Notice tone="danger">{checkout.error.message}</Notice>

    return (
        <div className="flex flex-col gap-4">
            {wallet && (
                <div className={cn('flex flex-col gap-4', !walletsShown && 'hidden')}>
                    <div className="relative">
                        <div className={cn(wallet.disabledReason && 'pointer-events-none opacity-50')}>
                            <ExpressCheckoutElement
                                options={WALLET_OPTIONS}
                                onAvailablePaymentMethodsChange={({ paymentMethods }) => setWalletsShown(!!paymentMethods)}
                                onConfirm={event => {
                                    if (wallet.disabledReason) return event.paymentFailed({ reason: 'fail', message: wallet.disabledReason })
                                    wallet.onConfirm(event)
                                }}
                            />
                        </div>
                        {wallet.disabledReason && (
                            <TooltipDisabledReason reason={wallet.disabledReason} className="absolute inset-0">
                                <span className="size-full" />
                            </TooltipDisabledReason>
                        )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="h-px flex-1 bg-border" />
                        {t('orPayWithCard')}
                        <span className="h-px flex-1 bg-border" />
                    </div>
                </div>
            )}
            <PaymentElement options={{ layout: 'tabs' }} />
            <BillingAddressElement />
            <TaxIdElement options={TAX_ID_OPTIONS} />
        </div>
    )
}

export function StripePromoCode({ disabled }: { disabled?: boolean }) {
    const t = useTranslations('billing.stripe')
    const checkout = useCheckout()
    if (checkout.type !== 'success') return null

    const session = checkout.checkout
    const discount = session.discountAmounts?.find(amount => amount.promotionCode)
    const discountCents = Math.max(discount?.minorUnitsAmount ?? 0, session.recurring?.dueNext.discount.minorUnitsAmount ?? 0)
    const applied = discount?.promotionCode
        ? { code: discount.promotionCode, discount: discount.percentOff != null ? t('percentOff', { percent: discount.percentOff }) : t('amountOff', { amount: usd(discountCents) }) }
        : null

    return (
        <PromoCodeField
            applied={applied}
            disabled={disabled}
            onApply={async code => {
                const result = await session.applyPromotionCode(code)
                return result.type === 'error' ? result.error.message : null
            }}
            onRemove={async () => {
                const result = await session.removePromotionCode()
                return result.type === 'error' ? result.error.message : null
            }}
        />
    )
}
