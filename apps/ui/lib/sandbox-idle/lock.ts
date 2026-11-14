import type { Database } from '@/app/api/database.types'

type ArchiveRow = Database['public']['Tables']['workspace_archives']['Row']

export type LockArchive = Pick<ArchiveRow, 'reason' | 'status' | 'reactivation_requested_at' | 'reactivation_approved_at' | 'reactivation_rejected_at'>

export const LOCK_ARCHIVE_COLUMNS = ['id', 'workspace_id', 'reason', 'status', 'archived_at', 'expires_at', 'reactivation_requested_at', 'reactivation_approved_at', 'reactivation_rejected_at'] as const

export function isSandboxLocked(archive: LockArchive | null | undefined): boolean {
    if (!archive || archive.reason !== 'inactivity') return false
    return archive.status !== 'restored' && !archive.reactivation_approved_at
}

export type ReactivationState = 'none' | 'requested' | 'rejected' | 'approved'

export function reactivationStateOf(archive: LockArchive | null | undefined): ReactivationState {
    if (!archive) return 'none'
    if (archive.reactivation_approved_at) return 'approved'
    if (archive.reactivation_rejected_at) return 'rejected'
    return archive.reactivation_requested_at ? 'requested' : 'none'
}
