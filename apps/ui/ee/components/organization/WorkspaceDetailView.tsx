'use client'

import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ExternalLinkIcon, PlusIcon, RotateCwIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { DISK_CRITICAL, isQuiet } from './console-alerts'
import { CreditTransferDialog } from './CreditTransferDialog'
import { wholeCredits } from './input'
import { InviteDialog } from './InviteDialog'
import { ClientBoard, Dot, Page, Section } from './parts'
import { InvitationList, PeopleList, PeopleSkeleton } from './PeopleList'
import { SquareLogo } from './SquareLogo'
import { isBusy, isOpenable, type ConsoleInvitation, type ConsoleMachine, type ConsolePerson, type ConsoleResult, type ConsoleWorkspace, type CreditTransfer, type InviteAnswer, type WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'
import { WorkspaceCredit } from './WorkspaceCredit'
import { WorkspaceMenu, type LifecycleAction } from './WorkspaceMenu'
import { WorkspaceSetup } from './WorkspaceSetup'
import { WorkspaceUsage } from './WorkspaceUsage'

const ROLES = ['admin', 'member'] as const

export type ClientRole = (typeof ROLES)[number]

export type DetailAction = LifecycleAction | 'restart' | 'open' | 'resend' | 'copyLink'

type WorkspaceDetailViewProps = {
    workspace: ConsoleWorkspace
    members: ConsolePerson<ClientRole>[]
    invitations: ConsoleInvitation[]
    reserveMicros: number
    machine: ConsoleMachine
    usage: ReactNode
    // What is running right now, so its button waits and the others stay put.
    pending: DetailAction | null
    block: WriteBlock | null
    onOpenWorkspace: () => void
    onInvite: (email: string, role: ClientRole) => Promise<ConsoleResult<InviteAnswer>>
    onRoleChange: (person: ConsolePerson<ClientRole>, role: ClientRole) => void
    onRemove: (person: ConsolePerson<ClientRole>) => void
    onRevoke: (invitation: ConsoleInvitation) => void
    onResend: () => void
    onCopyLink: () => void
    onAllocate: (transfer: CreditTransfer) => Promise<ConsoleResult>
    onTakeBack: (transfer: CreditTransfer) => Promise<ConsoleResult>
    onRestart: () => void
    onArchive: () => void
    onRestore: () => void
    onDelete: () => void
}

export function WorkspaceDetailView(props: WorkspaceDetailViewProps) {
    const { workspace, members, invitations, reserveMicros, machine, usage, pending, block, onInvite, onRoleChange, onRemove, onRevoke, onResend, onCopyLink, onAllocate, onTakeBack } = props
    const t = useTranslations('organization')
    const blockReason = useBlockReason(block)
    const [inviting, setInviting] = useState(false)
    const [takingBack, setTakingBack] = useState(false)
    const { name, status } = workspace
    const unavailable = isOpenable(status) ? undefined : isBusy(status) ? t('detail.notReady') : t('detail.archived')
    const adminCount = members.filter(member => member.role === 'admin').length
    const fresh = workspace.coworkerCount === 0
    // Going live only makes sense for one that is open.
    const settingUp = fresh && !isQuiet(workspace)

    const lockedReason = (person: ConsolePerson<ClientRole>) => blockReason ?? (person.role === 'admin' && adminCount <= 1 ? t('people.lastAdmin') : undefined)

    return (
        <Page>
            <div className="space-y-8">
                <header className="flex flex-wrap items-center gap-4">
                    <SquareLogo name={name} iconUrl={workspace.iconUrl} className="size-14 rounded-2xl" />
                    <h1 className="line-clamp-2 min-w-0 flex-1 basis-40 text-2xl font-medium tracking-tight text-balance break-words">{name}</h1>
                    <Actions {...props} blockReason={blockReason} unavailable={unavailable} onStartTakeBack={() => setTakingBack(true)} />
                </header>
                <div className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl ring-1 ring-border lg:grid-cols-[minmax(0,1fr)_20rem]">
                    {settingUp ? (
                        <div className="bg-background p-5 sm:p-8">
                            <WorkspaceSetup workspace={workspace} reason={blockReason} resending={pending === 'resend'} copying={pending === 'copyLink'} onResend={onResend} onCopyLink={onCopyLink} onInvite={() => setInviting(true)} />
                        </div>
                    ) : fresh ? (
                        <div className="flex h-72 items-center justify-center bg-background lg:h-[22rem]">
                            <SquareLogo name={name} iconUrl={workspace.iconUrl} className="size-20 rounded-3xl opacity-40 grayscale" />
                        </div>
                    ) : (
                        <ClientBoard workspace={workspace} maxZoom={1.4} className={cn('h-72 lg:h-[22rem]', isQuiet(workspace) && 'opacity-40 grayscale')} />
                    )}
                    <div className="flex min-w-0 flex-col justify-between gap-6 border-border p-5 max-lg:border-t lg:border-s">
                        <WorkspaceCredit workspace={workspace} reserveMicros={reserveMicros} reason={blockReason ?? unavailable} onAllocate={onAllocate} />
                        <dl className="space-y-3 border-t border-border pt-4">
                            <Line label={t('detail.status')}>
                                <StatusLine workspace={workspace} />
                            </Line>
                            <Line label={t('detail.machine')}>
                                <MachineLine machine={machine} />
                            </Line>
                            <Line label={t('detail.admin')}>
                                <AdminLine members={members} invitations={invitations} />
                            </Line>
                        </dl>
                    </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-16 gap-y-10 lg:grid-cols-2">
                    {(!settingUp || workspace.spentPerDayMicros > 0) && <Section title={t('detail.usage')}>{usage}</Section>}
                    <Section
                        title={t('detail.people')}
                        meta={members.length + invitations.length}
                        actions={
                            <TooltipDisabledReason reason={blockReason}>
                                <Button variant="outline" size="sm" disabled={!!blockReason} onClick={() => setInviting(true)}>
                                    <PlusIcon />
                                    {t('people.invite')}
                                </Button>
                            </TooltipDisabledReason>
                        }
                    >
                        {members.length + invitations.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t('people.empty')}</p>}
                        <PeopleList people={members} roles={ROLES} removeDescription={t('people.removeConfirm.workspace')} lockedReason={lockedReason} onRoleChange={onRoleChange} onRemove={onRemove} />
                        <InvitationList invitations={invitations} lockedReason={blockReason} onRevoke={onRevoke} />
                    </Section>
                </div>
            </div>

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
            <CreditTransferDialog direction={takingBack ? 'takeBack' : null} onOpenChange={setTakingBack} reserveMicros={reserveMicros} workspaces={[workspace]} fixedWorkspaceId={workspace.id} onSubmit={onTakeBack} />
        </Page>
    )
}

function Actions({ workspace, machine, pending, blockReason, unavailable, onOpenWorkspace, onRestart, onArchive, onRestore, onDelete, onStartTakeBack }: WorkspaceDetailViewProps & { blockReason?: string; unavailable?: string; onStartTakeBack: () => void }) {
    const t = useTranslations('organization')
    const { name, status, creditMicros } = workspace
    const archived = !isOpenable(status) && status !== 'archiving'
    const lifecycle = blockReason ?? (isBusy(status) ? t('danger.busy') : undefined)
    const reasons = {
        restart: blockReason ?? unavailable ?? (machine.state === 'none' ? t('machine.notStarted') : undefined),
        takeBack: blockReason ?? (wholeCredits(creditMicros) < 1 ? t('credit.workspaceEmpty') : undefined),
        lifecycle,
    }
    const restorable = archived && status !== 'restoring'
    return (
        <div className="flex shrink-0 gap-2">
            <WorkspaceMenu name={name} archived={archived} busy={pending === 'restart' || pending === 'archive' || pending === 'delete'} reasons={reasons} onRestart={onRestart} onTakeBack={onStartTakeBack} onArchive={onArchive} onDelete={onDelete} />
            {restorable ? (
                <TooltipDisabledReason reason={lifecycle}>
                    <Button disabled={!!lifecycle} loading={pending === 'restore'} onClick={onRestore}>
                        <RotateCwIcon />
                        {t('danger.restore')}
                    </Button>
                </TooltipDisabledReason>
            ) : (
                <TooltipDisabledReason reason={blockReason ?? unavailable}>
                    <Button disabled={!!blockReason || !!unavailable} loading={pending === 'open'} onClick={onOpenWorkspace}>
                        <ExternalLinkIcon />
                        {t('detail.open')}
                    </Button>
                </TooltipDisabledReason>
            )}
        </div>
    )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate">{children}</dd>
        </div>
    )
}

function StatusLine({ workspace: { status, pendingAdmin } }: { workspace: ConsoleWorkspace }) {
    const t = useTranslations('organization.status')
    const waiting = isOpenable(status) && status !== 'outOfCredit' && !!pendingAdmin
    const tone = status === 'outOfCredit' ? 'red' : waiting || status === 'provisioning' || status === 'suspended' ? 'amber' : status === 'active' ? 'green' : 'neutral'
    return (
        <span className="flex items-center gap-2">
            <Dot tone={tone} />
            {t(waiting ? 'waitingAdmin' : status)}
        </span>
    )
}

function MachineLine({ machine: { state, disk } }: { machine: ConsoleMachine }) {
    const t = useTranslations('organization.machine')
    const percent = disk ? Math.round((disk.usedMb / disk.totalMb) * 100) : null
    const critical = state === 'error' || (percent !== null && percent >= DISK_CRITICAL)
    return <span className={cn('tabular-nums', critical && 'text-destructive')}>{percent === null ? t(`states.${state}`) : t('summary', { state: t(`states.${state}`), percent })}</span>
}

function AdminLine({ members, invitations }: { members: ConsolePerson<ClientRole>[]; invitations: ConsoleInvitation[] }) {
    const t = useTranslations('organization.detail')
    const admin = members.find(member => member.role === 'admin')
    return admin?.name ?? admin?.email ?? invitations.find(invitation => invitation.role === 'admin')?.email ?? t('noAdmin')
}

export function WorkspaceDetailSkeleton() {
    const t = useTranslations('organization.detail')
    return (
        <Page>
            <div className="space-y-8">
                <div className="flex flex-wrap items-center gap-4">
                    <Skeleton className="size-14 rounded-2xl" />
                    <div className="min-w-0 flex-1 basis-40">
                        <Skeleton className="h-7 w-48 max-w-full" />
                    </div>
                    <div className="flex gap-2">
                        <Skeleton className="size-9 rounded-lg" />
                        <Skeleton className="h-9 w-24 rounded-lg" />
                    </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl ring-1 ring-border lg:grid-cols-[minmax(0,1fr)_20rem]">
                    <Skeleton className="h-72 rounded-none lg:h-[22rem]" />
                    <div className="flex flex-col justify-between gap-6 p-5">
                        <div className="space-y-4">
                            <Skeleton className="h-10 w-28" />
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-9 w-full rounded-lg" />
                        </div>
                        <div className="space-y-3 border-t border-border pt-4">
                            {[t('status'), t('machine'), t('admin')].map(label => (
                                <div key={label} className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{label}</span>
                                    <Skeleton className="h-4 w-24" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-16 gap-y-10 lg:grid-cols-2">
                    <Section title={t('usage')}>
                        <WorkspaceUsage balance={null} usage={null} />
                    </Section>
                    <Section title={t('people')}>
                        <PeopleSkeleton rows={3} />
                    </Section>
                </div>
            </div>
        </Page>
    )
}
