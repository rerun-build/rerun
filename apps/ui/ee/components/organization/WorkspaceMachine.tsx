'use client'

import { formatBytes } from '@rerun/i18n/format'
import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { RotateCwIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { MACHINE_STATE_TONE, type ConsoleMachine } from './types'

const MEGABYTE = 1024 * 1024
const DISK_WARNING = 75
const DISK_CRITICAL = 90

type WorkspaceMachineProps = {
    machine: ConsoleMachine | null
    restarting: boolean
    restartReason?: string
    onRestart: () => void
}

export function WorkspaceMachine({ machine, restarting, restartReason, onRestart }: WorkspaceMachineProps) {
    const t = useTranslations('organization.machine')
    const [confirming, setConfirming] = useState(false)
    return (
        <div className={cn('flex flex-1 flex-col justify-between gap-4 p-4', PANEL_CARD)}>
            {machine ? <MachineFigures machine={machine} /> : <MachineSkeleton />}
            <div className="flex items-center justify-between gap-3">
                {machine ? (
                    <Badge size="xs" tone={MACHINE_STATE_TONE[machine.state]} glow={false} className="font-medium">
                        {t(`states.${machine.state}`)}
                    </Badge>
                ) : (
                    <Skeleton className="h-5 w-16 rounded-full" />
                )}
                <TooltipDisabledReason reason={restartReason}>
                    <Button variant="outline" disabled={!machine || !!restartReason} loading={restarting} onClick={() => setConfirming(true)}>
                        <RotateCwIcon />
                        {t('restart')}
                    </Button>
                </TooltipDisabledReason>
            </div>
            <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={t('restartConfirm.title')} description={t('restartConfirm.description')} confirmLabel={t('restartConfirm.confirm')} confirmVariant="default" onConfirm={onRestart} />
        </div>
    )
}

function MachineFigures({ machine: { state, disk } }: { machine: ConsoleMachine }) {
    const t = useTranslations('organization.machine')
    const locale = useLocale()
    const percent = disk ? (disk.usedMb / disk.totalMb) * 100 : 0
    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{t('disk')}</span>
                <span className="tabular-nums">{disk ? t('diskUsed', { used: formatBytes(disk.usedMb * MEGABYTE, locale), total: formatBytes(disk.totalMb * MEGABYTE, locale) }) : t(state === 'none' ? 'notStarted' : 'diskUnknown')}</span>
            </div>
            <Progress value={percent} size="md" label={t('disk')} tone={percent >= DISK_CRITICAL ? 'destructive' : percent >= DISK_WARNING ? 'warning' : 'brand'} />
        </div>
    )
}

function MachineSkeleton() {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
    )
}
