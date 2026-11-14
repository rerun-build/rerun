'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { useStartPending } from '@/lib/onboarding/useStartPending'
import { useOnboardingStore } from '@/stores/onboarding.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { Loader2Icon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

function short(title: string): string {
    return title.length > 40 ? `${title.slice(0, 39)}…` : title
}

export function PostPaymentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('billing.postPayment')
    const { workspace } = useSession()
    const startPending = useStartPending()
    const pendingTemplate = useOnboardingStore(s => s.pendingTemplate)
    const [starting, setStarting] = useState(false)

    const subscriptionReady = isSubscriptionEntitled(workspace?.subscription_status)

    const handleStart = async () => {
        if (!workspace || starting) return
        setStarting(true)
        try {
            await startPending()
            onOpenChange(false)
        } catch {
            setStarting(false)
        }
    }

    const needsPlacement = !!pendingTemplate?.needsPlacement
    const readyDescription = pendingTemplate
        ? needsPlacement
            ? t('ready.place', { title: short(pendingTemplate.title) })
            : t('ready.setUp', { title: short(pendingTemplate.title) })
        : t('ready.first')
    const count = pendingTemplate?.agentCount ?? 1
    const many = count > 1
    const idleLabel = needsPlacement ? (many ? t('button.placeMany', { count }) : t('button.placeOne')) : many ? t('button.startMany', { count }) : t('button.startOne')
    const busyLabel = needsPlacement ? (many ? t('button.placingMany', { count }) : t('button.placingOne')) : many ? t('button.startingMany', { count }) : t('button.startingOne')

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                    <DialogDescription>{subscriptionReady ? readyDescription : t('finalizing')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button onClick={handleStart} disabled={!subscriptionReady || starting}>
                        {(starting || !subscriptionReady) && <Loader2Icon className="size-4 animate-spin" />}
                        {starting ? busyLabel : subscriptionReady ? idleLabel : t('button.finalizing')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
