import type { User } from '@supabase/supabase-js'
import type { Brand } from '@rerun/contracts'
import type { Locale } from '@rerun/i18n'

// No organization in this build: every workspace carries Rerun's own brand, every host is Rerun's, and
// nobody's account is tied to the team of one. No 'server-only', like its Rerun Cloud twin: the emails
// sent from a background task ask for a brand too.
export async function organizationBrandOfWorkspace(_workspaceId: number): Promise<Brand | null> {
    return null
}

export async function organizationDefaultUrlOfWorkspace(_workspaceId: number): Promise<string | null> {
    return null
}

export async function organizationBrandOfAccount(_account: { userId: string | null; email: string }): Promise<Brand | null> {
    return null
}

export type HostedOrganization = { brand: Brand; organizationId: string; suspended: boolean; defaultOrigin: string | null }

export async function organizationOfHost(_address: { kind: 'organization'; slug: string } | { kind: 'domain'; hostname: string }): Promise<HostedOrganization | null> {
    return null
}

// Whether the edge may get a certificate for a name.
export async function isServedHostname(_hostname: string): Promise<boolean> {
    return false
}

export type InvitedSignIn = { organizationId: string; brand: Brand; email: string; ip: string; locale: Locale }
export type InvitedSignInOutcome = 'asked' | 'too_many'

export async function askInvitedSignInCode(_ask: InvitedSignIn): Promise<InvitedSignInOutcome> {
    return 'too_many'
}

export async function joinOrganization(_user: User, _organizationId: string, _options: { locale: Locale }): Promise<{ signedUp: boolean } | null> {
    return null
}

export async function isInOrganizationTeam(_organizationId: string, _userId: string): Promise<boolean> {
    return false
}

export async function leaveOrganizations(_userId: string): Promise<void> {}

export async function reachesBeyondOrganization(_userId: string, _organizationId: string): Promise<boolean> {
    return false
}

// The machine of an organization's workspace, as its console drives it.
export type OrganizationMachine = { managed: boolean; running: boolean | null; disk: { usedMb: number; totalMb: number } | null }

const NO_ORGANIZATIONS = 'Organizations are part of Rerun Cloud.'

export async function readOrganizationMachine(_workspaceId: number): Promise<OrganizationMachine | null> {
    return null
}

export async function archiveOrganizationMachine(_workspaceId: number): Promise<void> {
    throw new Error(NO_ORGANIZATIONS)
}

export async function restoreOrganizationMachine(_workspaceId: number): Promise<void> {
    throw new Error(NO_ORGANIZATIONS)
}

export async function restartOrganizationMachine(_workspaceId: number): Promise<void> {
    throw new Error(NO_ORGANIZATIONS)
}

export async function destroyOrganizationMachine(_workspaceId: number): Promise<void> {
    throw new Error(NO_ORGANIZATIONS)
}
