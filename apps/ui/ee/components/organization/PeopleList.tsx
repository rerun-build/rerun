'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { Face } from './parts'
import type { ConsoleInvitation, ConsolePerson, PersonRole } from './types'

const LINE = 'flex items-center gap-3 border-b border-border py-3 last:border-b-0'

type PeopleListProps<Role extends PersonRole> = {
    people: ConsolePerson<Role>[]
    roles: readonly Role[]
    // What a removal costs the person.
    removeDescription: string
    // Why this person's row cannot change, when it cannot.
    lockedReason: (person: ConsolePerson<Role>) => string | undefined
    onRoleChange: (person: ConsolePerson<Role>, role: Role) => void
    onRemove: (person: ConsolePerson<Role>) => void
}

export function PeopleList<Role extends PersonRole>({ people, roles, removeDescription, lockedReason, onRoleChange, onRemove }: PeopleListProps<Role>) {
    return people.map(person => <PersonLine key={person.userId} person={person} roles={roles} removeDescription={removeDescription} lockedReason={lockedReason(person)} onRoleChange={role => onRoleChange(person, role)} onRemove={() => onRemove(person)} />)
}

function PersonLine<Role extends PersonRole>({ person, roles, removeDescription, lockedReason, onRoleChange, onRemove }: { person: ConsolePerson<Role>; roles: readonly Role[]; removeDescription: string; lockedReason?: string; onRoleChange: (role: Role) => void; onRemove: () => void }) {
    const t = useTranslations('organization.people')
    const tRoles = useTranslations('organization.roles')
    const name = person.name ?? person.email ?? t('unknown')
    return (
        <div className={LINE}>
            <Face name={name} photo={person.photo} />
            <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{name}</span>
                    {person.isSelf && <span className="shrink-0 text-xs font-normal text-muted-foreground">{t('you')}</span>}
                </p>
                {person.name && person.email && <p className="truncate text-xs text-muted-foreground">{person.email}</p>}
            </div>
            <TooltipDisabledReason reason={lockedReason}>
                <Select value={person.role} onValueChange={role => onRoleChange(role as Role)} disabled={!!lockedReason}>
                    <SelectTrigger aria-label={t('role', { name })} className="border-transparent bg-transparent shadow-none hover:bg-muted dark:bg-transparent">
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
            <RemoveButton label={t('remove', { name })} lockedReason={lockedReason} title={t('removeConfirm.title', { name })} description={removeDescription} confirmLabel={t('removeConfirm.confirm')} onConfirm={onRemove} />
        </div>
    )
}

export function InvitationList({ invitations, lockedReason, onRevoke }: { invitations: ConsoleInvitation[]; lockedReason?: string; onRevoke: (invitation: ConsoleInvitation) => void }) {
    const t = useTranslations('organization.people')
    const tRoles = useTranslations('organization.roles')
    return invitations.map(invitation => {
        const { id, email, role } = invitation
        return (
            <div key={id} className={LINE}>
                <Face name={email} className="opacity-50" />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-muted-foreground">{email}</p>
                    <p className="truncate text-xs text-muted-foreground">{t('pending')}</p>
                </div>
                {role && <span className="shrink-0 px-2.5 text-sm text-muted-foreground">{tRoles(role)}</span>}
                <RemoveButton label={t('revoke', { email })} lockedReason={lockedReason} title={t('revokeConfirm.title')} description={t('revokeConfirm.description', { email })} confirmLabel={t('revokeConfirm.confirm')} cancelLabel={t('revokeConfirm.keep')} onConfirm={() => onRevoke(invitation)} />
            </div>
        )
    })
}

function RemoveButton({ label, lockedReason, title, description, confirmLabel, cancelLabel, onConfirm }: { label: string; lockedReason?: string; title: string; description: string; confirmLabel: string; cancelLabel?: string; onConfirm: () => void }) {
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
    return Array.from({ length: rows }, (_, index) => (
        <div key={index} className={LINE}>
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className={cn('h-3.5 max-w-full', index % 2 ? 'w-24' : 'w-36')} />
                <Skeleton className={cn('h-3 max-w-full', index % 2 ? 'w-40' : 'w-48')} />
            </div>
            <Skeleton className="h-8 w-20 shrink-0 rounded-lg" />
        </div>
    ))
}
