'use client'

import { CardAvatar } from '@rerun/ui/chat'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { PanelList } from '@/components/ui/panel-list'
import { PANEL_CARD, PanelRow } from '@/components/ui/panel-row'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { INITIALS } from './SquareLogo'
import type { ConsoleInvitation, ConsolePerson, PersonRole } from './types'

const asIs = (path: string) => path

type PeopleListProps<Role extends PersonRole> = {
    people: ConsolePerson<Role>[]
    invitations: ConsoleInvitation[]
    roles: readonly Role[]
    // What a removal costs the person.
    removeDescription: string
    // Why this person's row cannot change, when it cannot.
    lockedReason: (person: ConsolePerson<Role>) => string | undefined
    invitationsLockedReason?: string
    onRoleChange: (person: ConsolePerson<Role>, role: Role) => void
    onRemove: (person: ConsolePerson<Role>) => void
    onRevoke: (invitation: ConsoleInvitation) => void
}

export function PeopleList<Role extends PersonRole>({ people, invitations, roles, removeDescription, lockedReason, invitationsLockedReason, onRoleChange, onRemove, onRevoke }: PeopleListProps<Role>) {
    const t = useTranslations('organization.people')
    if (people.length + invitations.length === 0) return <p className={cn('p-4 text-center text-sm text-muted-foreground', PANEL_CARD)}>{t('empty')}</p>
    return (
        <PanelList>
            {people.map(person => (
                <PersonRow key={person.userId} person={person} roles={roles} removeDescription={removeDescription} lockedReason={lockedReason(person)} onRoleChange={role => onRoleChange(person, role)} onRemove={() => onRemove(person)} />
            ))}
            {invitations.map(invitation => (
                <InvitationRow key={invitation.id} invitation={invitation} lockedReason={invitationsLockedReason} onRevoke={() => onRevoke(invitation)} />
            ))}
        </PanelList>
    )
}

function PersonRow<Role extends PersonRole>({ person, roles, removeDescription, lockedReason, onRoleChange, onRemove }: { person: ConsolePerson<Role>; roles: readonly Role[]; removeDescription: string; lockedReason?: string; onRoleChange: (role: Role) => void; onRemove: () => void }) {
    const t = useTranslations('organization.people')
    const tRoles = useTranslations('organization.roles')
    const name = person.name ?? person.email ?? t('unknown')
    return (
        <PanelRow
            leading={<CardAvatar src={person.photo} fileUrl={asIs} name={name} className={cn('size-8', INITIALS)} />}
            title={
                <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{name}</span>
                    {person.isSelf && <span className="shrink-0 text-xs font-normal text-muted-foreground">{t('you')}</span>}
                </span>
            }
            actions={
                <>
                    <TooltipDisabledReason reason={lockedReason}>
                        <Select value={person.role} onValueChange={role => onRoleChange(role as Role)} disabled={!!lockedReason}>
                            <SelectTrigger aria-label={t('role', { name })}>
                                <SelectValue>{tRoles(person.role as PersonRole)}</SelectValue>
                            </SelectTrigger>
                            <SelectContent position="popper" align="end">
                                {roles.map(role => (
                                    <SelectItem key={role} value={role}>
                                        {tRoles(role as PersonRole)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </TooltipDisabledReason>
                    <RowRemoveButton label={t('remove', { name })} lockedReason={lockedReason} title={t('removeConfirm.title', { name })} description={removeDescription} confirmLabel={t('removeConfirm.confirm')} onConfirm={onRemove} />
                </>
            }
        >
            {person.name && person.email && <span className="truncate text-xs text-muted-foreground">{person.email}</span>}
        </PanelRow>
    )
}

function InvitationRow({ invitation, lockedReason, onRevoke }: { invitation: ConsoleInvitation; lockedReason?: string; onRevoke: () => void }) {
    const t = useTranslations('organization.people')
    const tRoles = useTranslations('organization.roles')
    const { email, role } = invitation
    return (
        <PanelRow
            className="border-dashed bg-transparent"
            leading={<CardAvatar name={email} className={cn('size-8 opacity-60', INITIALS)} />}
            title={<span className="text-muted-foreground">{email}</span>}
            description={role && tRoles(role)}
            meta={
                <Badge size="xs" tone="neutral" glow={false} className="font-medium">
                    {t('pending')}
                </Badge>
            }
            actions={<RowRemoveButton label={t('revoke', { email })} lockedReason={lockedReason} title={t('revokeConfirm.title')} description={t('revokeConfirm.description', { email })} confirmLabel={t('revokeConfirm.confirm')} cancelLabel={t('revokeConfirm.keep')} onConfirm={onRevoke} />}
        />
    )
}

function RowRemoveButton({ label, lockedReason, title, description, confirmLabel, cancelLabel, onConfirm }: { label: string; lockedReason?: string; title: string; description: string; confirmLabel: string; cancelLabel?: string; onConfirm: () => void }) {
    const [confirming, setConfirming] = useState(false)
    return (
        <>
            <TooltipDisabledReason reason={lockedReason}>
                <Button variant="ghost" size="icon" aria-label={label} disabled={!!lockedReason} className="text-muted-foreground" onClick={() => setConfirming(true)}>
                    <XIcon />
                </Button>
            </TooltipDisabledReason>
            <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={title} description={description} confirmLabel={confirmLabel} cancelLabel={cancelLabel} onConfirm={onConfirm} />
        </>
    )
}

export function PeopleSkeleton({ rows = 3 }: { rows?: number }) {
    return (
        <PanelList>
            {Array.from({ length: rows }, (_, index) => (
                <div key={index} className={cn('flex items-center gap-3 p-3', PANEL_CARD)}>
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Skeleton className={cn('h-3.5 max-w-full', index % 2 ? 'w-24' : 'w-36')} />
                        <Skeleton className={cn('h-3 max-w-full', index % 2 ? 'w-40' : 'w-48')} />
                    </div>
                    <Skeleton className="h-8 w-20 shrink-0 rounded-lg" />
                </div>
            ))}
        </PanelList>
    )
}
