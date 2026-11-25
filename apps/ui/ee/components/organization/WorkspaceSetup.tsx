'use client'

import { formatCredits } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { CheckIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { Section } from './parts'
import type { ConsoleWorkspace } from './types'

type WorkspaceSetupProps = { workspace: ConsoleWorkspace; reason?: string; resending: boolean; copying: boolean; onResend: () => void; onCopyLink: () => void; onInvite: () => void }

type Step = { id: string; label: string; done: boolean; actions?: ReactNode }

// What stands between a new workspace and its first coworker.
export function WorkspaceSetup({ workspace, reason, resending, copying, onResend, onCopyLink, onInvite }: WorkspaceSetupProps) {
    const t = useTranslations('organization.setup')
    const locale = useLocale()
    const { pendingAdmin, memberCount, creditMicros } = workspace
    const invited = !!pendingAdmin && memberCount === 0
    const invitationActions = (
        <>
            <TooltipDisabledReason reason={reason}>
                <Button variant="outline" size="sm" disabled={!!reason} loading={copying} onClick={onCopyLink}>
                    {t('copyLink')}
                </Button>
            </TooltipDisabledReason>
            <TooltipDisabledReason reason={reason}>
                <Button variant="outline" size="sm" disabled={!!reason} loading={resending} onClick={onResend}>
                    {t('resend')}
                </Button>
            </TooltipDisabledReason>
        </>
    )
    const inviteAction = (
        <TooltipDisabledReason reason={reason}>
            <Button variant="outline" size="sm" disabled={!!reason} onClick={onInvite}>
                {t('invite')}
            </Button>
        </TooltipDisabledReason>
    )
    const steps: Step[] = [
        { id: 'created', label: t('created'), done: true },
        { id: 'credit', label: creditMicros > 0 ? t('credit', { amount: formatCredits(creditMicros, locale) }) : t('creditMissing'), done: creditMicros > 0 },
        { id: 'admin', label: invited ? t(pendingAdmin.expired ? 'adminExpired' : 'adminJoins', { email: pendingAdmin.email }) : memberCount > 0 ? t('adminJoined') : t('adminMissing'), done: memberCount > 0, actions: memberCount > 0 ? undefined : invited ? invitationActions : inviteAction },
        { id: 'coworker', label: t('coworker'), done: workspace.coworkerCount > 0 },
    ]
    const now = steps.find(step => !step.done && step.actions) ?? steps.find(step => !step.done)
    return (
        <Section title={t('title')} meta={t('progress', { done: steps.filter(step => step.done).length, total: steps.length })}>
            {steps.map(({ id, label, done, actions }) => (
                <div key={id} className="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border py-2">
                    <span className="flex w-5 justify-center">{done ? <CheckIcon aria-label={t('done')} className="size-4 text-brand" /> : id === now?.id ? <Spinner className="size-4" /> : <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/40" />}</span>
                    <span className={cn('min-w-0 flex-1 basis-40 text-sm break-words', id === now?.id ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
                    {actions && <span className="flex gap-2">{actions}</span>}
                </div>
            ))}
        </Section>
    )
}
