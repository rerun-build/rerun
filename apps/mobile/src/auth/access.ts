import { FOREMAN_AGENT_ID, type BoardAgent, type Box, type BoxAccessLevel, type WorkspaceRole } from '@rerun/contracts'

export type AccessReason = 'boxManage' | 'aiProvidersAdminOnly' | 'noManagedBox' | 'boxesFailed' | 'noBoxYet'

export const BOX_MANAGE_REASON: AccessReason = 'boxManage'
export const AI_PROVIDERS_ADMIN_ONLY: AccessReason = 'aiProvidersAdminOnly'
export const NO_MANAGED_BOX: AccessReason = 'noManagedBox'

export const isAdminRole = (role: WorkspaceRole | undefined): boolean => role !== 'member'

export const canManage = (access: BoxAccessLevel | undefined): boolean => access !== 'use'

export const manageReason = (access: BoxAccessLevel | undefined): AccessReason | null => (canManage(access) ? null : BOX_MANAGE_REASON)

export const manageableBoxes = (boxes: readonly Box[]): Box[] => boxes.filter(box => canManage(box.access))

export function boxForNewCoworker(manageable: readonly Box[], wanted: string | null): string | null {
    if (wanted && manageable.some(box => box.id === wanted)) return wanted
    return manageable[0]?.id ?? null
}

export function newCoworkerBlocker({ failed, manageable, admin }: { failed: boolean; manageable: readonly Box[] | null; admin: boolean }): AccessReason | null {
    if (failed) return 'boxesFailed'
    if (!manageable || manageable.length > 0) return null
    return admin ? 'noBoxYet' : NO_MANAGED_BOX
}

export type CoworkerAccess = { access: BoxAccessLevel | undefined; known: boolean }

export const UNKNOWN_ACCESS: CoworkerAccess = { access: undefined, known: false }

type AccessSources = { agents?: readonly Pick<BoardAgent, 'id' | 'access'>[] | null; views?: readonly ({ agent: Pick<BoardAgent, 'access'> } | null | undefined)[] }

export function knownCoworkerAccess(agentId: string, sources: AccessSources): CoworkerAccess {
    if (agentId === FOREMAN_AGENT_ID) return { access: 'manage', known: true }
    const agent = sources.agents?.find(candidate => candidate.id === agentId)
    if (agent) return { access: agent.access, known: true }
    const view = sources.views?.find(candidate => !!candidate)
    return view ? { access: view.agent.access, known: true } : UNKNOWN_ACCESS
}

export type ManageLock = { locked: boolean; reason: AccessReason | null }

export const OPEN_LOCK: ManageLock = { locked: false, reason: null }

export function manageLock({ access, known }: CoworkerAccess): ManageLock {
    if (!known) return { locked: true, reason: null }
    return { locked: !canManage(access), reason: manageReason(access) }
}
