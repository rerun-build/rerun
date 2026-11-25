import type { OrganizationMachineState, OrganizationWorkspaceStatus } from '@/ee/lib/organizations/workspace-state'
import type { OrganizationCoworker } from '@/ee/services/organization-workspaces.service'
import type { CreditMovement as OrganizationCreditMovement } from '@/ee/services/organization-credit.service'
import type { Refusal } from '@/hooks/useErrorText'

export type ConsoleSection = 'workspaces' | 'credit' | 'team' | 'brand' | 'domains'

export type OrganizationRole = 'owner' | 'admin'

export type PersonRole = OrganizationRole | 'member'

export type OrganizationIdentity = { name: string; iconUrl: string | null }

// Why the whole page is read only, when it is.
export type WriteBlock = 'suspended' | 'ownerOnly'

export type ConsoleRefusal = { ok: false } & Refusal

export type ConsoleResult<Answer = unknown> = ({ ok: true } & Answer) | ConsoleRefusal

// `inviteUrl` comes back where no email leaves: the link is then handed over by hand.
export type InviteAnswer = { inviteUrl?: string }

export type ConsoleWorkspaceStatus = 'active' | 'archived' | 'archiving' | 'restoring' | 'provisioning' | 'outOfCredit' | 'suspended'

export type ConsoleWorkspace = {
    id: number
    name: string
    iconUrl: string | null
    status: ConsoleWorkspaceStatus
    memberCount: number
    coworkerCount: number
    coworkers: OrganizationCoworker[]
    pendingAdmin: { invitationId: string; email: string; expired: boolean } | null
    creditMicros: number
    spentPerDayMicros: number
    machine: OrganizationMachineState
    diskPercent: number | null
    lastActivityAt: string | null
}

export type ConsolePerson<Role extends PersonRole> = { userId: string; name: string | null; email: string | null; photo: string | null; role: Role; isSelf: boolean }

export type ConsoleInvitation = { id: string; email: string; role?: PersonRole }

export type CreditMovement = Pick<OrganizationCreditMovement, 'id' | 'kind' | 'workspaceName' | 'actorName' | 'note' | 'micros' | 'reversed' | 'reversalOf' | 'createdAt'>

// `requestId` is the same for every send of the same transfer: a double click moves the credit once.
export type CreditTransfer = { workspaceId: number; credits: number; requestId: string }

type MachineState = OrganizationMachineState | 'stopped'

export type ConsoleMachine = { state: MachineState; disk: { usedMb: number; totalMb: number } | null }

export type BrandFields = { name: string; color: string; supportEmail: string; docsUrl: string; termsUrl: string; privacyUrl: string }

export type DnsRecord = { type: 'CNAME' | 'TXT'; name: string; value: string }

export type DomainStatus = 'pending' | 'active' | 'error'

export type ConsoleDomain = { id: string; hostname: string; status: DomainStatus; error: string | null; records: DnsRecord[]; lastCheckedAt: string | null }

// One word for where a workspace stands: what its organization did to it, then its machine, then its
// credit. `provisioning` until someone uses it, which is what takes it a machine.
export function consoleStatusOf(workspace: { status: OrganizationWorkspaceStatus; machine: OrganizationMachineState; leftMicros: number }): ConsoleWorkspaceStatus {
    const { status, machine, leftMicros } = workspace
    if (status === 'suspended') return 'suspended'
    if (machine === 'archiving' || machine === 'restoring') return machine
    if (status === 'archived') return 'archived'
    if (machine === 'none') return 'provisioning'
    return leftMicros > 0 ? 'active' : 'outOfCredit'
}

// It can be opened and given credit.
export function isOpenable(status: ConsoleWorkspaceStatus): boolean {
    return status === 'active' || status === 'outOfCredit' || status === 'provisioning'
}

// Something is happening to it: the next change waits.
export function isBusy(status: ConsoleWorkspaceStatus): boolean {
    return status === 'archiving' || status === 'restoring'
}
