'use client'

import type { ReactNode } from 'react'

import { RERUN_CLOUD } from '@moldwright/cloud/edition'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { ArrowLeftIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

import { MoldwrightGlyph } from './offer-plans'

export function OfferFooter({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
    const t = useTranslations('dialogs.subscriptionOffer')
    return (
        <DialogFooter className={cn('-mx-6 -mb-6 mt-auto border-t bg-muted/50 px-6 py-4 sm:-mx-8 sm:-mb-8 sm:items-center sm:px-8', onBack && 'sm:justify-between')}>
            {onBack && (
                <Button variant="ghost" onClick={onBack}>
                    <ArrowLeftIcon />
                    {t('back')}
                </Button>
            )}
            {children}
        </DialogFooter>
    )
}

export function DeclineButton({ onClick }: { onClick: () => void }) {
    const t = useTranslations('dialogs.subscriptionOffer')
    return (
        <Button variant="destructive" onClick={onClick}>
            <MoldwrightGlyph className="size-3.5" />
            {RERUN_CLOUD ? t('decline.cloud') : t('decline.selfHosted')}
        </Button>
    )
}
