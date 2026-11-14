export type ArchiveRowLike = { workspace_id: number; archived_at: string | null }

export function latestCompletedArchives<T extends ArchiveRowLike>(rows: T[]): Map<number, T> {
    const latest = new Map<number, T>()
    for (const row of rows) {
        if (!row.archived_at) continue
        const known = latest.get(row.workspace_id)
        if (!known || Date.parse(row.archived_at) > Date.parse(known.archived_at as string)) latest.set(row.workspace_id, row)
    }
    return latest
}
