// What a published page may do with one table of its workspace's machine. A table missing from the
// list is out of the page's reach: "No access" is never stored, it removes the table.
export type DataGrantLevel = 'read' | 'write'

// `database` is `shared` for the workspace's shared database, or the `agents.id` of the coworker whose
// own database holds the table.
export type DataGrant = { database: string; table: string; grant: DataGrantLevel }

export const SHARED_DATABASE = 'shared'

export function isDataGrantLevel(value: unknown): value is DataGrantLevel {
    return value === 'read' || value === 'write'
}

// The page reaches a table by its name alone, so a name is listed once: the first entry wins.
export function parseDataGrants(value: unknown): DataGrant[] {
    if (!Array.isArray(value)) return []
    const grants: DataGrant[] = []
    for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const { database, table, grant } = item as Record<string, unknown>
        if (typeof database !== 'string' || !database || typeof table !== 'string' || !table || !isDataGrantLevel(grant)) continue
        if (grants.some(existing => existing.table === table)) continue
        grants.push({ database, table, grant })
    }
    return grants
}

export function findDataGrant(grants: readonly DataGrant[], table: string): DataGrant | null {
    return grants.find(grant => grant.table === table) ?? null
}
