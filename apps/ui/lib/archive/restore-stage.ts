import type { Database } from '@/app/api/database.types'

type ArchiveStatus = Database['public']['Enums']['workspace_archive_status']

export type RestoreStage = 'machine' | 'data' | 'agents' | 'waiting' | 'failed'

export function restoreStageOf(archive: { status: ArchiveStatus; error_message: string | null } | null, hasMachine: boolean): RestoreStage {
    if (!archive) return 'machine'
    if (archive.status === 'restoring') return hasMachine ? 'data' : 'machine'
    if (archive.status === 'restored') return archive.error_message ? 'failed' : 'agents'
    if (archive.status === 'archived' && archive.error_message?.startsWith('Restore failed')) return 'waiting'
    return 'machine'
}
