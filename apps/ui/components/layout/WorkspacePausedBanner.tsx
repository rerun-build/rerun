'use client'

import { getSandboxArchiveStateAction, getWorkspaceRestoreStageAction, type SandboxArchiveState } from '@/app/api/_actions/workspace-restore.actions'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { RequestSandboxReactivationDialog } from '@/components/dialogs/RequestSandboxReactivationDialog'
import { Button } from '@/components/ui/button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import type { RestoreStage } from '@/lib/archive/restore-stage'
import { AlertCircleIcon, ArchiveIcon, CircleCheckIcon, ClockIcon, LoaderIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useBillingStore } from '@/stores/billing.store'
import { useSandboxArchiveStore } from '@/stores/sandbox-archive.store'
import { useSession } from '@/supabase/session/SessionProvider'
import { formatDate } from '@rerun/i18n/format'
import { ChromeBar } from '@rerun/ui/chrome'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useState } from 'react'

const RESTORE_STEPS: readonly Exclude<RestoreStage, 'waiting' | 'failed'>[] = ['machine', 'data', 'agents']

const STAGE_POLL_MS = 4000
// An approval is a human's doing: nothing here changes by the second.
const SANDBOX_ARCHIVE_POLL_MS = 15_000

export function formatKeptUntil(date: Date, locale: string): string {
    return formatDate(date, locale, { month: 'short', day: 'numeric' })
}

// The board of a workspace whose machine was archived when its plan ended, and of one coming back
// after a payment. The agents stay drawn, locked: this is the one place that says why and how out.
export function WorkspacePausedBanner() {
    const { access, keptUntil, paymentFailed, sandboxArchived } = useWorkspaceAccess()
    const { workspace } = useSession()
    const isSandbox = !!workspace?.is_sandbox
    if (access === 'live') return null

    return (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--chrome-edge)+var(--chrome-size)+var(--chrome-gap))] z-30 flex justify-center px-4 md:top-(--chrome-edge)">
            <ChromeBar start="icon" className="pointer-events-auto max-w-full font-normal md:max-w-[calc(100%-26rem)]">
                {isSandbox && workspace && <SandboxArchiveSync workspaceId={workspace.id} />}
                {sandboxArchived ? <SandboxArchivedBanner keptUntil={keptUntil} /> : access === 'paused' ? <PausedContent keptUntil={keptUntil} paymentFailed={paymentFailed} /> : <RestoringContent approved={isSandbox} />}
            </ChromeBar>
        </div>
    )
}

export function PausedContent({ keptUntil, paymentFailed = false }: { keptUntil: Date | null; paymentFailed?: boolean }) {
    const t = useTranslations('layout.paused')
    const locale = useLocale()
    return (
        <>
            <ArchiveIcon className="relative size-4 shrink-0 text-muted-foreground" />
            <p className="relative min-w-0 truncate text-sm">
                <span className="font-medium">{paymentFailed ? t('paymentFailed') : t('title')}</span>{' '}
                <span className="text-muted-foreground max-sm:hidden">{keptUntil ? t('savedUntil', { date: formatKeptUntil(keptUntil, locale) }) : t('saved')}</span>
            </p>
            <Button className="shrink-0 rounded-full px-3" onClick={() => useBillingStore.getState().openBilling(undefined, 'paused_banner')}>
                {paymentFailed ? t('updatePayment') : t('subscribe')}
            </Button>
        </>
    )
}

// Keeps the store in step with the server for as long as the banner shows: an approval turns the
// sandbox to restoring, and a restore that landed clears the store once the session has caught up.
function SandboxArchiveSync({ workspaceId }: { workspaceId: number }) {
    const refresh = useCallback(() => {
        getSandboxArchiveStateAction()
            .then(archive => useSandboxArchiveStore.getState().setArchive(workspaceId, archive))
            .catch(() => {})
    }, [workspaceId])
    useVisibleInterval(refresh, SANDBOX_ARCHIVE_POLL_MS)
    return null
}

// The connected half: reads what the server said, and owns the request dialog.
function SandboxArchivedBanner({ keptUntil }: { keptUntil: Date | null }) {
    const { workspace } = useSession()
    const stored = useSandboxArchiveStore(s => (workspace && s.workspaceId === workspace.id ? s.archive : null))
    const [requesting, setRequesting] = useState(false)
    const markRequested = () => {
        if (workspace) useSandboxArchiveStore.getState().setArchive(workspace.id, { status: 'requested', keptUntil: stored?.keptUntil ?? null })
    }

    return (
        <>
            <SandboxArchivedContent keptUntil={keptUntil} status={stored?.status ?? 'none'} onRequest={() => setRequesting(true)} />
            <RequestSandboxReactivationDialog open={requesting} onOpenChange={setRequesting} onRequested={markRequested} />
        </>
    )
}

export function SandboxArchivedContent({ keptUntil, status, onRequest }: { keptUntil: Date | null; status: SandboxArchiveState['status']; onRequest?: () => void }) {
    const t = useTranslations('layout.sandboxArchived')
    const locale = useLocale()
    return (
        <>
            <ArchiveIcon className="relative size-4 shrink-0 text-muted-foreground" />
            <p className="relative min-w-0 truncate text-sm">
                <span className="font-medium">{status === 'rejected' ? t('declined') : status === 'requested' ? t('requested') : t('title')}</span>{' '}
                <span className="text-muted-foreground max-sm:hidden">
                    {status === 'rejected'
                        ? t('declinedHint')
                        : keptUntil
                          ? t('savedUntil', { date: formatKeptUntil(keptUntil, locale) })
                          : t('expired')}
                </span>
            </p>
            {status !== 'rejected' && (
                <TooltipDisabledReason reason={status === 'requested' ? t('requestedReason') : undefined} className="shrink-0 rounded-full">
                    <Button className="shrink-0 rounded-full px-3" disabled={status === 'requested'} onClick={onRequest}>
                        {t('request')}
                    </Button>
                </TooltipDisabledReason>
            )}
        </>
    )
}

// `approved`: a sandbox coming back on an approval rather than a payment, which changes what the
// two stalled states have to say.
function RestoringContent({ approved = false }: { approved?: boolean }) {
    const t = useTranslations('layout.restoring')
    const [stage, setStage] = useState<RestoreStage>('machine')
    const poll = useCallback(() => {
        getWorkspaceRestoreStageAction()
            .then(next => next && setStage(next))
            .catch(() => {})
    }, [])
    useVisibleInterval(poll, STAGE_POLL_MS)

    if (stage === 'waiting') {
        return (
            <div className="relative flex min-w-0 items-center gap-2 pr-3">
                <ClockIcon className="size-4 shrink-0 text-muted-foreground" />
                <p className="min-w-0 truncate text-sm">
                    <span className="font-medium">{approved ? t('waitingApproved') : t('waitingPaid')}</span> <span className="text-muted-foreground max-sm:hidden">{t('waitingHint')}</span>
                </p>
            </div>
        )
    }

    // The teardown refuses this one every tick and never retries it: no "within minutes" here.
    if (stage === 'failed') {
        return (
            <div className="relative flex min-w-0 items-center gap-2 pr-3">
                <AlertCircleIcon className="size-4 shrink-0 text-muted-foreground" />
                <p className="min-w-0 truncate text-sm">
                    <span className="font-medium">{t('failed')}</span> <span className="text-muted-foreground max-sm:hidden">{approved ? t('failedApproved') : t('failedPaid')}</span>
                </p>
            </div>
        )
    }

    const current = RESTORE_STEPS.indexOf(stage)
    return (
        <div className="relative flex min-w-0 items-center gap-4 pr-3 pl-1">
            <Shimmer as="span" duration={1.6} className="text-sm font-medium whitespace-nowrap">
                {t('title')}
            </Shimmer>
            <div className="flex items-center gap-3 max-md:hidden">
                {RESTORE_STEPS.map((step, index) => {
                    const done = index < current
                    const active = index === current
                    return (
                        <span key={step} className={cn('flex items-center gap-1.5 text-xs whitespace-nowrap', done || active ? 'text-foreground' : 'text-muted-foreground')}>
                            {done ? <CircleCheckIcon className="size-3.5 text-emerald-500" /> : active ? <LoaderIcon className="size-3.5 animate-spin" /> : <span className="size-3.5 rounded-full border border-border" />}
                            {active && step === 'machine' ? t('steps.machineActive') : t(`steps.${step}`)}
                        </span>
                    )
                })}
            </div>
        </div>
    )
}
