import { agentDataBase, listDbTables, SPACE_DATA_BASE } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { SHARED_DATABASE, type DataGrant, type DataGrantLevel } from '@/lib/published/data-grants'

// A table the coworker's page reads, in the shared database or in its own.
export type PageTableRequest = { name: string; database: 'shared' | 'own'; access: DataGrantLevel }

// The grants a coworker asked for, kept to the tables that exist: a page names a table once.
export async function grantsForPage(conn: EngineConnection, agentId: string, engineAgentId: string, requests: readonly PageTableRequest[]): Promise<RequestedTables> {
    const wanted = requests.filter((request, index) => requests.findIndex(other => other.name === request.name) === index)
    const bases = { shared: SPACE_DATA_BASE, own: agentDataBase(engineAgentId) }
    const needed = [...new Set(wanted.map(request => request.database))]
    const listed = new Map(await Promise.all(needed.map(async database => [database, (await listDbTables(conn, bases[database])).map(table => table.name)] as const)))
    const grants: DataGrant[] = []
    const missing: string[] = []
    for (const request of wanted) {
        if (listed.get(request.database)?.includes(request.name)) grants.push({ database: request.database === 'own' ? agentId : SHARED_DATABASE, table: request.name, grant: request.access })
        else missing.push(request.name)
    }
    return { grants, missing }
}

export type RequestedTables = { grants: DataGrant[]; missing: string[] }

// What a publish keeps: the tables asked for on a page or a site, none on any other file (nothing
// there runs the script that reads them), and on a page republished without `tables` the ones it had.
export function publishedTables(isPage: boolean, requested: RequestedTables | null, stored: DataGrant[]): { grants: DataGrant[]; changed: boolean; message: string } {
    if (!isPage) {
        const asked = !!requested && requested.grants.length + requested.missing.length > 0
        return { grants: [], changed: true, message: asked ? 'Only a page or a site (a folder with an index.html) reads tables live, so the tables you named were left out.' : '' }
    }
    if (!requested) return { grants: stored, changed: false, message: '' }
    return { grants: requested.grants, changed: true, message: tablesMessage(requested.grants, requested.missing) }
}

export function tablesMessage(grants: readonly DataGrant[], missing: readonly string[]): string {
    const parts: string[] = []
    if (grants.length > 0) parts.push(`The page reads ${grants.map(grant => `${grant.table} (${grant.grant === 'write' ? 'view and add' : 'view'})`).join(', ')} live through window.rerun.data; the user can change this in Share.`)
    if (missing.length > 0) parts.push(`No table named ${missing.join(', ')} in the database you named, so the page cannot read it: create it first, then publish again.`)
    return parts.join(' ')
}
