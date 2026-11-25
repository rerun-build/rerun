'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { PlusIcon } from '@/lib/icons'

import { ConsolePage } from './ConsolePage'
import { InviteDialog } from './InviteDialog'
import { PeopleList, PeopleSkeleton } from './PeopleList'
import type { ConsoleInvitation, ConsolePerson, ConsoleResult, InviteAnswer, OrganizationRole, WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'

const ROLES = ['owner', 'admin'] as const

type TeamViewProps = {
    people: ConsolePerson<OrganizationRole>[] | null
    invitations: ConsoleInvitation[]
    block: WriteBlock | null
    onInvite: (email: string, role: OrganizationRole) => Promise<ConsoleResult<InviteAnswer>>
    onRoleChange: (person: ConsolePerson<OrganizationRole>, role: OrganizationRole) => void
    onRemove: (person: ConsolePerson<OrganizationRole>) => void
    onRevoke: (invitation: ConsoleInvitation) => void
}

export function TeamView({ people, invitations, block, onInvite, onRoleChange, onRemove, onRevoke }: TeamViewProps) {
    const t = useTranslations('organization')
    const blockReason = useBlockReason(block)
    const [inviting, setInviting] = useState(false)
    const ownerCount = people?.filter(person => person.role === 'owner').length ?? 0

    const lockedReason = (person: ConsolePerson<OrganizationRole>) => {
        if (blockReason) return blockReason
        if (person.role === 'owner' && ownerCount <= 1) return t('people.lastOwner')
        return person.isSelf ? t('people.self') : undefined
    }

    return (
        <ConsolePage
            title={t('team.title')}
            description={t('team.description')}
            actions={
                <TooltipDisabledReason reason={blockReason}>
                    <Button disabled={!people || !!blockReason} onClick={() => setInviting(true)}>
                        <PlusIcon />
                        {t('people.invite')}
                    </Button>
                </TooltipDisabledReason>
            }
        >
            {people ? (
                <PeopleList people={people} invitations={invitations} roles={ROLES} removeDescription={t('people.removeConfirm.team')} lockedReason={lockedReason} invitationsLockedReason={blockReason} onRoleChange={onRoleChange} onRemove={onRemove} onRevoke={onRevoke} />
            ) : (
                <PeopleSkeleton />
            )}
            <InviteDialog
                open={inviting}
                onOpenChange={setInviting}
                title={t('invite.teamTitle')}
                roles={[
                    { value: 'admin', description: t('invite.roles.admin') },
                    { value: 'owner', description: t('invite.roles.owner') },
                ]}
                onInvite={onInvite}
            />
        </ConsolePage>
    )
}
