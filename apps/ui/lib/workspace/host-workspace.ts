// The workspaces a host opens: an organization's address, those of that organization; Rerun's own, the
// ones no organization runs. Shared by the server's session and the browser's, which have to agree.
// `null` instead of a scope: an install without organizations, where any workspace opens anywhere.
export type HostScope = { organizationId: string | null }

export type HostMembership = { workspaceId: number; organizationId: string | null; joinedAt: string }

// An organization's address remembers the workspace last opened on it: the stored one moves with
// whatever the account opens elsewhere.
export const LAST_WORKSPACE_COOKIE = 'rerun-last-workspace'

export function readWorkspaceId(raw: string | null | undefined): number | null {
    return raw && /^\d{1,15}$/.test(raw) ? Number(raw) : null
}

export function opensOnHost(scope: HostScope | null, organizationId: string | null): boolean {
    return scope === null || scope.organizationId === organizationId
}

// The first candidate the host opens, else the workspace they joined first. Null when it opens none of
// theirs.
export function pickHostWorkspace(scope: HostScope, memberships: HostMembership[], candidates: (number | null)[]): number | null {
    const open = memberships.filter(membership => opensOnHost(scope, membership.organizationId))
    const wanted = candidates.find(id => id !== null && open.some(membership => membership.workspaceId === id))
    if (wanted) return wanted
    const [earliest] = [...open].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.workspaceId - b.workspaceId)
    return earliest?.workspaceId ?? null
}
