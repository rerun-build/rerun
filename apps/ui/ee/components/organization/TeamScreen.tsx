'use client'

import { inviteOrganizationTeamMemberAction, listOrganizationTeamAction, removeOrganizationTeamMemberAction, revokeOrganizationTeamInvitationAction, setOrganizationTeamRoleAction } from '@/ee/actions/organization.actions'

import { consoleTeamOf, type Team } from './console-data'
import { useConsole, useWriteBlock } from './ConsoleProvider'
import { TeamView } from './TeamView'
import { useConsoleChange } from './useConsoleChange'
import { useConsoleData } from './useConsoleData'

export function TeamScreen({ initial }: { initial: Team }) {
    const { userId } = useConsole()
    const block = useWriteBlock('owner')
    const { data, expect, reload } = useConsoleData<Team>(initial, listOrganizationTeamAction)
    const { submit, change } = useConsoleChange(reload)

    return (
        <TeamView
            {...consoleTeamOf(data, userId)}
            block={block}
            onInvite={(email, role) => submit(() => inviteOrganizationTeamMemberAction(email, role))}
            onRoleChange={(person, role) => {
                const undo = expect(current => ({ ...current, members: current.members.map(member => (member.userId === person.userId ? { ...member, role } : member)) }))
                void change(() => setOrganizationTeamRoleAction(person.userId, role), undo)
            }}
            onRemove={person => {
                const undo = expect(current => ({ ...current, members: current.members.filter(member => member.userId !== person.userId) }))
                void change(() => removeOrganizationTeamMemberAction(person.userId), undo)
            }}
            onRevoke={invitation => {
                const undo = expect(current => ({ ...current, invitations: current.invitations.filter(invite => invite.id !== invitation.id) }))
                void change(() => revokeOrganizationTeamInvitationAction(invitation.id), undo)
            }}
        />
    )
}
