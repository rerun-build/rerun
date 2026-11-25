import type { OrganizationCredit } from '@/ee/services/organization-credit.service'
import type { OrganizationDomain } from '@/ee/services/organization-domains.service'
import type { DomainProblem } from '@/ee/lib/organizations/domain-state'
import type { OrganizationTeam } from '@/ee/services/organization-team.service'
import type { OrganizationWorkspaceDetail, OrganizationWorkspaceSummary } from '@/ee/services/organization-workspaces.service'
import type { MemberEntry, InviteEntry } from '@/app/api/_services/members.service'

import { consoleStatusOf, type ConsoleDomain, type ConsoleInvitation, type ConsoleMachine, type ConsolePerson, type ConsoleWorkspace, type OrganizationRole } from './types'
import type { ClientRole } from './WorkspaceDetailView'

// What the services answer, as the views draw it.

export function consoleWorkspaceOf(summary: OrganizationWorkspaceSummary, unnamed: string): ConsoleWorkspace {
    const { id, name, iconUrl, memberCount, coworkerCount, leftMicros, lastActiveAt } = summary
    return { id, name: name || unnamed, iconUrl, status: consoleStatusOf(summary), memberCount, coworkerCount, creditMicros: leftMicros, lastActivityAt: lastActiveAt }
}

export function consoleMachineOf({ machine, hardware }: OrganizationWorkspaceDetail): ConsoleMachine {
    return { state: machine === 'running' && hardware?.running === false ? 'stopped' : machine, disk: hardware?.disk ?? null }
}

export type WorkspacePeople = { members: MemberEntry[]; invites: InviteEntry[] }

export function consoleMembersOf({ members, invites }: WorkspacePeople, selfId: string): { members: ConsolePerson<ClientRole>[]; invitations: ConsoleInvitation[] } {
    return {
        members: members.map(({ userId, email, role }) => ({ userId, name: null, email, photo: null, role, isSelf: userId === selfId })),
        invitations: invites.map(({ id, email, role }) => ({ id, email, role })),
    }
}

export type Team = Pick<OrganizationTeam, 'members' | 'invitations'>

export function consoleTeamOf({ members, invitations }: Team, selfId: string): { people: ConsolePerson<OrganizationRole>[]; invitations: ConsoleInvitation[] } {
    return {
        people: members.map(({ userId, name, email, avatarUrl, role }) => ({ userId, name, email, photo: avatarUrl, role, isSelf: userId === selfId })),
        invitations: invitations.map(({ id, email, role }) => ({ id, email, role })),
    }
}

// The pages already shown stay under a fresh first one, unless so much happened since that the two no
// longer touch.
export function mergeCreditHistory(fresh: OrganizationCredit, known: OrganizationCredit): OrganizationCredit {
    const oldestFresh = fresh.movements.at(-1)
    const older = oldestFresh ? known.movements.filter(movement => movement.seq < oldestFresh.seq) : []
    const touches = !!oldestFresh && known.movements.some(movement => movement.seq >= oldestFresh.seq - 1)
    if (!touches || older.length === 0) return fresh
    return { ...fresh, movements: [...fresh.movements, ...older], nextBeforeSeq: known.nextBeforeSeq }
}

export function consoleDomainOf({ problem, ...domain }: OrganizationDomain, words: (problem: DomainProblem) => string): ConsoleDomain {
    return { ...domain, error: problem && words(problem) }
}
