'use client'

import { isPublicStatus, type TemplateStatus } from '@rerun/contracts'
import * as React from 'react'
import { useTranslations } from 'next-intl'
import { useFormContext } from 'react-hook-form'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Gauge } from '@/components/ui/gauge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CircleCheckIcon, CircleIcon, RotateCwIcon, SendIcon, Trash2Icon } from '@/lib/icons'
import type { TemplateFormValues } from '@/lib/templates/edit-schema'
import { templateSubmitChecklist } from '@/lib/templates/submit'
import { useCreatorStore } from '@/stores/creator.store'
import { cn } from '@/lib/utils'

// The one place a template changes hands. The checklist is computed from the live form, so the
// button explains itself instead of failing server-side: it is the same list `submitMyTemplateAction`
// enforces.
export function TemplateSubmitFooter({
    status,
    reviewNote,
    payoutsReady,
    saving,
    onSubmit,
    onWithdraw,
    onDelete,
}: {
    status: string
    reviewNote: string | null
    // Only a paid template needs it, and the server re-resolves it on submit: this is what the
    // checklist renders, not what decides.
    payoutsReady: boolean
    saving: boolean
    onSubmit: () => Promise<boolean>
    onWithdraw: () => Promise<boolean>
    onDelete: () => Promise<boolean>
}) {
    const t = useTranslations('templates.expert.footer')
    // Subscribes the footer to every field: the checklist has to move as the author types.
    const { watch, formState } = useFormContext<TemplateFormValues>()
    const values = watch()
    const setPane = useCreatorStore(state => state.setPane)
    const [pending, startTransition] = React.useTransition()
    // Which button to spin: the transition is shared, so `pending` alone would light them all up.
    const [running, setRunning] = React.useState<'submit' | 'withdraw' | 'delete' | null>(null)

    const run = (action: 'submit' | 'withdraw' | 'delete', act: () => Promise<boolean>) => {
        setRunning(action)
        startTransition(async () => {
            await act()
            setRunning(null)
        })
    }

    const inReview = status === 'in_review'
    const live = isPublicStatus(status as TemplateStatus)

    if (live) {
        return (
            <footer className="border-t border-border px-5 py-4">
                <p className="text-xs text-muted-foreground">{t('live')}</p>
            </footer>
        )
    }

    if (inReview) {
        return (
            <footer className="flex items-center gap-3 border-t border-border px-5 py-4">
                <p className="text-xs text-muted-foreground">{t('inReview')}</p>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    loading={running === 'withdraw'}
                    disabled={pending}
                    onClick={() => run('withdraw', onWithdraw)}
                >
                    <RotateCwIcon className="size-3.5" />
                    {t('withdraw')}
                </Button>
            </footer>
        )
    }

    const checklist = templateSubmitChecklist(values, t, { payoutsReady })
    const metCount = checklist.filter(requirement => requirement.met).length
    const ready = metCount === checklist.length
    const readyTone = ready ? 'text-emerald-500' : 'text-muted-foreground'
    // Submitting reads the stored row, so an unsaved edit would not be part of what we review.
    const blocker = !ready ? t('completeChecklist') : formState.isDirty ? t('saveFirst') : null

    return (
        <footer className="flex flex-col gap-3 border-t border-border px-5 py-4">
            {reviewNote && (
                <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                    <p className="font-medium">{t('sentBack')}</p>
                    <p className="mt-0.5 whitespace-pre-line">{reviewNote}</p>
                </div>
            )}

            <div className="flex items-center gap-2">
                <ConfirmDialog
                    title={t('deleteTitle')}
                    description={t('deleteDescription')}
                    onConfirm={() => run('delete', onDelete)}
                >
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        loading={running === 'delete'}
                        disabled={pending || saving}
                        title={t('deleteTooltip')}
                        aria-label={t('deleteLabel')}
                        className="text-muted-foreground hover:text-destructive"
                    >
                        <Trash2Icon className="size-3.5" />
                    </Button>
                </ConfirmDialog>

                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            aria-label={t('checklistLabel', { met: metCount, total: checklist.length })}
                        >
                            <Gauge ratio={metCount / checklist.length} complete={ready} className={cn(readyTone, ready && 'hover:text-emerald-500')} />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64">
                        <div className="mb-2 flex items-center justify-between gap-4">
                            <span className="text-xs font-medium">{t('ready')}</span>
                            <span className={cn('flex items-center gap-1.5 text-xs font-medium tabular-nums', readyTone)}>
                                {metCount}/{checklist.length}
                                {ready && <CircleCheckIcon className="size-3.5" />}
                            </span>
                        </div>
                        <p className="mb-2 text-xs text-muted-foreground">{t('checklistHint')}</p>
                        <ul className="flex flex-col gap-1.5">
                            {checklist.map(requirement => (
                                <li key={requirement.id} className={cn('flex flex-col gap-0.5 text-xs', requirement.met ? 'text-foreground' : 'text-muted-foreground')}>
                                    <span className="flex items-center gap-2">
                                        {requirement.met ? <CircleCheckIcon className="size-3.5 text-emerald-500" /> : <CircleIcon className="size-3.5" />}
                                        {requirement.label}
                                    </span>
                                    {!requirement.met && requirement.id === 'payouts' && (
                                        <button type="button" className="ml-5 w-fit text-left underline" onClick={() => setPane({ kind: 'payouts' })}>
                                            {t('setUpPayouts')}
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </PopoverContent>
                </Popover>

                <Button type="submit" size="sm" variant="secondary" loading={saving} disabled={saving || pending}>
                    {t('save')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    loading={running === 'submit'}
                    disabled={blocker !== null || saving || pending}
                    title={blocker ?? undefined}
                    onClick={() => run('submit', onSubmit)}
                >
                    <SendIcon className="size-3.5" />
                    {t('submit')}
                </Button>
            </div>
        </footer>
    )
}
