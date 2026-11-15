export type BoxAccess = 'none' | 'use' | 'manage'
export type SpaceGrant = { space_id: string; user_id: string; access: string }

export type BoxViewer = { userId: string | null; role: 'admin' | 'member' | null; boxScope: 'all' | 'assigned' | null }

export function boxAccessFor(viewer: BoxViewer, space: { id: string; visibility?: string | null } | null | undefined, grants: readonly SpaceGrant[]): BoxAccess {
    if (!space || !viewer.userId || !viewer.role) return 'none'
    if (viewer.role === 'admin') return 'manage'
    const grant = grants.find(row => row.space_id === space.id && row.user_id === viewer.userId)
    if (grant?.access === 'manage') return 'manage'
    if (grant?.access === 'use') return 'use'
    if (viewer.boxScope !== 'assigned' && (space.visibility ?? 'workspace') === 'workspace') return 'use'
    return 'none'
}

export const BOX_MANAGE_REASON = 'Only an admin or a manager of this Box can change this'
export const BOX_MANAGE_ACTION_REASON = 'Only an admin or a manager of this Box can do this'
export const ACCESS_LOST_MESSAGE = 'You no longer have access to this Box'
