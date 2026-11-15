'use client'

import { Orb } from '@rerun/ui/foreman'
import { ScrollFade } from '@rerun/ui/primitives'

import type { SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import { DialogHeader } from '@/components/ui/dialog'
import { useTranslations } from 'next-intl'

import { OfferArguments } from './offer-arguments'
import { DeclineButton, OfferFooter } from './offer-footer'
import { OfferConnect } from './OfferConnect'

export function OfferStep({ onPick, onKey, onOpencode, onSkip }: { onPick: (provider: SubscriptionProvider) => void; onKey: () => void; onOpencode?: () => void; onSkip: () => void }) {
    const t = useTranslations('dialogs.subscriptionOffer.offer')
    return (
        <>
            <DialogHeader className="mb-5">
                <Orb size={40} state="speaking" facing="right" className="mb-4" />
                <h2 className="text-xl font-semibold text-balance">{t('title')}</h2>
                <p className="text-sm text-muted-foreground">{t('description')}</p>
            </DialogHeader>

            <OfferConnect onPick={onPick} onKey={onKey} onOpencode={onOpencode} />

            <ScrollFade className="-mx-1 flex min-h-0 flex-1 flex-col px-1 [&>div]:my-auto [&>div]:py-6">
                <OfferArguments />
            </ScrollFade>

            <OfferFooter>
                <DeclineButton onClick={onSkip} />
            </OfferFooter>
        </>
    )
}
