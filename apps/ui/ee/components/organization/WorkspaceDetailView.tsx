'use client'

import { formatCredits } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { PANEL_CARD } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ExternalLinkIcon, PlusIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { wholeCredits } from './input'
import { ConsoleGroup, ConsolePage } from './ConsolePage'
import { CreditTransferDialog, type TransferDirection } from './CreditTransferDialog'
import { InviteDialog } from './InviteDialog'
import { PeopleList, PeopleSkeleton } from './PeopleList'
import { SquareLogo } from './SquareLogo'
import { isBusy, isOpenable, type ConsoleInvitation, type ConsoleMachine, type ConsolePerson, type ConsoleResult, type ConsoleWorkspace, type CreditTransfer, type InviteAnswer, type WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'
import { WorkspaceLifecycle, type LifecycleAction } from './WorkspaceLifecycle'
import { WorkspaceMachine } from './WorkspaceMachine'
import { WorkspaceStatusBadge } from './WorkspacesView'
import { WorkspaceUsage } from './WorkspaceUsage'

const ROLES = ['admin', 'member'] as const

export type ClientRole = (typeof ROLES)[number]

type WorkspaceDetailViewProps = {
    workspace: ConsoleWorkspace
    members: ConsolePerson<ClientRole>[] | null
    invitations: ConsoleInvitation[]
    reserveMicros: number
    machine: ConsoleMachine | null
    usage: ReactNode
    // What is running right now, so its button waits and the others stay put.
    pending: LifecycleAction | 'restart' | 'open' | null
    block: WriteBlock | null
    onBack: () => void
    onOpenWorkspace: () => void
    onInvite: (email: string, role: ClientRole) => Promise<ConsoleResult<InviteAnswer>>
    onRoleChange: (person: ConsolePerson<ClientRole>, role: ClientRole) => void
    onRemove: (person: ConsolePerson<ClientRole>) => void
    onRevoke: (invitation: ConsoleInvitation) => void
    onAllocate: (transfer: CreditTransfer) => Promise<ConsoleResult>
    onTakeBack: (transfer: CreditTransfer) => Promise<ConsoleResult>
    onRestart: () => void
    onArchive: () => void
    onRestore: () => void
    onDelete: () => void
}

export function WorkspaceDetailView(props: WorkspaceDetailViewProps) {
    const { workspace, members, invitations, machine, usage, pending, block, onBack, onOpenWorkspace, onInvite, onRoleChange, onRemove, onRevoke, onRestart, onArchive, onRestore, onDelete } = props
    const t = useTranslations('organization')
    const blockReason = useBlockReason(block)
    const [inviting, setInviting] = useState(false)
    const { name, status } = workspace
    const unavailable = isOpenable(status) ? undefined : isBusy(status) ? t('detail.notReady') : t('detail.archived')
    const adminCount = members?.filter(member => member.role === 'admin').length ?? 0

    const lockedReason = (person: ConsolePerson<ClientRole>) => blockReason ?? (person.role === 'admin' && adminCount <= 1 ? t('people.lastAdmin') : undefined)

    return (
        <ConsolePage
            back={{ label: t('detail.back'), onClick: onBack }}
            leading={<SquareLogo name={name} iconUrl={workspace.iconUrl} className="size-11" />}
            title={name}
            meta={<WorkspaceStatusBadge status={status} />}
            actions={
                <TooltipDisabledReason reason={blockReason ?? unavailable}>
                    <Button disabled={!!blockReason || !!unavailable} loading={pending === 'open'} onClick={onOpenWorkspace}>
                        <ExternalLinkIcon />
                        {t('detail.open')}
                    </Button>
                </TooltipDisabledReason>
            }
        >
            <div className="grid gap-6 sm:grid-cols-2">
                <ConsoleGroup title={t('detail.credit')}>
                    <WorkspaceCredit {...props} blockReason={blockReason} unavailable={unavailable} />
                </ConsoleGroup>
                <ConsoleGroup title={t('detail.machine')}>
                    <WorkspaceMachine machine={machine} restarting={pending === 'restart'} restartReason={blockReason ?? unavailable ?? (machine?.state === 'none' ? t('machine.notStarted') : undefined)} onRestart={onRestart} />
                </ConsoleGroup>
            </div>

            <ConsoleGroup
                title={t('detail.members')}
                actions={
                    <TooltipDisabledReason reason={blockReason}>
                        <Button variant="outline" size="sm" disabled={!members || !!blockReason} onClick={() => setInviting(true)}>
                            <PlusIcon />
                            {t('people.invite')}
                        </Button>
                    </TooltipDisabledReason>
                }
            >
                {members ? (
                    <PeopleList people={members} invitations={invitations} roles={ROLES} removeDescription={t('people.removeConfirm.workspace')} lockedReason={lockedReason} invitationsLockedReason={blockReason} onRoleChange={onRoleChange} onRemove={onRemove} onRevoke={onRevoke} />
                ) : (
                    <PeopleSkeleton rows={2} />
                )}
            </ConsoleGroup>

            <ConsoleGroup title={t('detail.usage')}>{usage}</ConsoleGroup>

            <ConsoleGroup title={t('detail.danger')}>
                <WorkspaceLifecycle workspace={workspace} pending={pending === 'restart' || pending === 'open' ? null : pending} blockReason={blockReason} onArchive={onArchive} onRestore={onRestore} onDelete={onDelete} />
            </ConsoleGroup>

            <InviteDialog
                open={inviting}
                onOpenChange={setInviting}
                title={t('invite.workspaceTitle', { name })}
                roles={[
                    { value: 'member', description: t('invite.roles.workspaceMember') },
                    { value: 'admin', description: t('invite.roles.workspaceAdmin') },
                ]}
                onInvite={onInvite}
            />
        </ConsolePage>
    )
}

function WorkspaceCredit({ workspace, reserveMicros, blockReason, unavailable, onAllocate, onTakeBack }: Pick<WorkspaceDetailViewProps, 'workspace' | 'reserveMicros' | 'onAllocate' | 'onTakeBack'> & { blockReason?: string; unavailable?: string }) {
    const t = useTranslations('organization.credit')
    const locale = useLocale()
    const [direction, setDirection] = useState<TransferDirection | null>(null)
    const { creditMicros } = workspace
    const allocateReason = blockReason ?? unavailable ?? (wholeCredits(reserveMicros) < 1 ? t('reserveEmpty') : undefined)
    const takeBackReason = blockReason ?? (wholeCredits(creditMicros) < 1 ? t('workspaceEmpty') : undefined)
    return (
        <div className={cn('flex flex-1 flex-col justify-between gap-4 p-4', PANEL_CARD)}>
            <div className="space-y-1">
                <p className={cn('text-2xl font-semibold tabular-nums', creditMicros <= 0 && 'text-destructive')}>{formatCredits(creditMicros, locale)}</p>
                <p className="text-xs text-muted-foreground">{t('left')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <TooltipDisabledReason reason={allocateReason}>
                    <Button variant="outline" disabled={!!allocateReason} onClick={() => setDirection('allocate')}>
                        <PlusIcon />
                        {t('add')}
                    </Button>
                </TooltipDisabledReason>
                <TooltipDisabledReason reason={takeBackReason}>
                    <Button variant="ghost" disabled={!!takeBackReason} onClick={() => setDirection('takeBack')}>
                        {t('takeBack')}
                    </Button>
                </TooltipDisabledReason>
            </div>
            <CreditTransferDialog direction={direction} onOpenChange={open => !open && setDirection(null)} reserveMicros={reserveMicros} workspaces={[workspace]} fixedWorkspaceId={workspace.id} onSubmit={direction === 'takeBack' ? onTakeBack : onAllocate} />
        </div>
    )
}

export function WorkspaceDetailSkeleton() {
    const t = useTranslations('organization')
    return (
        <ConsolePage title={<Skeleton className="h-5 w-40" />} leading={<Skeleton className="size-11 shrink-0 rounded-lg" />} actions={<Skeleton className="h-9 w-36 rounded-lg" />}>
            <div className="grid gap-6 sm:grid-cols-2">
                <ConsoleGroup title={t('detail.credit')}>
                    <div className={cn('flex flex-1 flex-col justify-between gap-4 p-4', PANEL_CARD)}>
                        <div className="space-y-2">
                            <Skeleton className="h-7 w-20" />
                            <Skeleton className="h-3 w-28" />
                        </div>
                        <Skeleton className="h-9 w-32 rounded-lg" />
                    </div>
                </ConsoleGroup>
                <ConsoleGroup title={t('detail.machine')}>
                    <WorkspaceMachine machine={null} restarting={false} onRestart={() => {}} />
                </ConsoleGroup>
            </div>
            <ConsoleGroup title={t('detail.members')}>
                <PeopleSkeleton rows={2} />
            </ConsoleGroup>
            <ConsoleGroup title={t('detail.usage')}>
                <WorkspaceUsage balance={null} usage={null} />
            </ConsoleGroup>
        </ConsolePage>
    )
}
