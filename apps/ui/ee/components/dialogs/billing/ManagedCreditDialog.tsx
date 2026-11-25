'use client'

import { useLocale, useTranslations } from 'next-intl'

import { ContactManagerButton } from '@/components/brand/ContactManagerButton'
import type { WorkspaceManager } from '@/components/brand/useWorkspaceManager'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { DialogContent } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCredits } from '@/ee/lib/billing/plans'
import { CoinsIcon, TriangleAlertIcon } from '@/lib/icons'

import { KindLegend, SplitBar } from './credit-usage/parts'
import { RerunCreditSwitch } from './credit-usage/RerunCreditSwitch'
import { useCreditUsage } from './credit-usage/useCreditUsage'

// Every openBilling() of a workspace an organization runs lands here: what its credit stands at, and
// the switch that pauses it for an admin. Nothing is sold.
export function ManagedCreditDialog({ manager, canPause }: { manager: WorkspaceManager; canPause: boolean }) {
    const t = useTranslations('managed.credit')
    const tBilling = useTranslations('billing')
    const locale = useLocale()
    const { balance, paused } = useCreditUsage()
    const out = !paused && !!balance && balance.leftMicros <= 0

    return (
        <DialogContent className="max-h-[calc(100dvh_-_2rem)] overflow-y-auto sm:max-w-md">
            <DialogHeaderBar icon={CoinsIcon} title={t('title')} description={t('providedBy', { manager: manager.name })} />
            {out && (
                <Alert variant="danger" className="flex flex-wrap items-center gap-3">
                    <TriangleAlertIcon className="size-4 shrink-0" />
                    <div className="min-w-0 flex-1 basis-40">
                        <AlertTitle>{t('outTitle')}</AlertTitle>
                        <AlertDescription>{t('out', { manager: manager.name })}</AlertDescription>
                    </div>
                    <ContactManagerButton manager={manager} size="sm" />
                </Alert>
            )}
            {balance ? (
                <div className="flex flex-col gap-2.5">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">{tBilling('usage.card.used')}</span>
                        <span className="tabular-nums">{tBilling('usage.card.usedOf', { used: formatCredits(balance.usedAiMicros + balance.usedDataMicros, locale), whole: formatCredits(balance.wholeMicros, locale) })}</span>
                    </div>
                    <SplitBar balance={balance} trial />
                    <KindLegend balance={balance} />
                </div>
            ) : (
                <div className="flex flex-col gap-2.5">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-2.5 w-full rounded-full" />
                    <Skeleton className="h-3.5 w-56 max-w-full" />
                </div>
            )}
            {canPause && (
                <div className="border-t pt-4">
                    <RerunCreditSwitch paused={paused} />
                </div>
            )}
        </DialogContent>
    )
}
