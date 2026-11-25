import 'server-only'
import { getWorkspaceConnection } from '@/app/api/_services/workspace-engine.service'
import type { Database } from '@/app/api/database.types'
import { agentDataBase, listDbTables, SPACE_DATA_BASE } from '@/lib/engine/client'
import { AppError } from '@/lib/i18n/action-error'
import { parseDataGrants, SHARED_DATABASE, type DataGrant } from '@/lib/published/data-grants'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectAll, selectMaybeSingle } from '@/supabase/supabase-helpers'

// The "Live data" section of the share dialog: which tables of the machine a page reads, and the
// ones it could. The shared database comes first, then the own database of each coworker.

export type PageTable = {
    database: string
    // Null for the workspace's shared database, the coworker's name otherwise.
    owner: string | null
    table: string
    rows: number | null
}

export type PageData = { listed: (PageTable & { grant: DataGrant['grant'] })[]; others: PageTable[] }

type MachineTable = PageTable & { visible: boolean }

// A coworker's database the machine could not list right now: its tables are unknown, not gone.
type UnlistedDatabase = { owner: string; visible: boolean }

type Machine = { tables: MachineTable[]; unlisted: Map<string, UnlistedDatabase> }

async function machineTables(workspaceId: number, visibleAgents: 'all' | Set<string>): Promise<Machine> {
    const conn = await getWorkspaceConnection(workspaceId)
    const { data } = await selectAll(createServiceRoleClient(), 'agents', ['id', 'name', 'engine_agent_id'] as const, { workspace_id: workspaceId }, { column: 'name', ascending: true })
    const databases = [
        { id: SHARED_DATABASE, owner: null, base: SPACE_DATA_BASE, visible: true },
        ...(data ?? []).flatMap(agent => (agent.engine_agent_id ? [{ id: agent.id, owner: agent.name, base: agentDataBase(agent.engine_agent_id), visible: visibleAgents === 'all' || visibleAgents.has(agent.id) }] : [])),
    ]
    const unlisted = new Map<string, UnlistedDatabase>()
    const listed = await Promise.all(
        databases.map(async database => {
            const tables = await listDbTables(conn, database.base, { counts: true }).catch(err => {
                if (database.owner === null) throw new AppError('workspaceMachineUnreachable')
                console.warn('[published-data] could not list the tables of a coworker:', err)
                unlisted.set(database.id, { owner: database.owner, visible: database.visible })
                return []
            })
            return tables.map(table => ({ database: database.id, owner: database.owner, table: table.name, rows: table.rows ?? null, visible: database.visible }))
        })
    )
    return { tables: listed.flat(), unlisted }
}

async function storedGrants(workspaceId: number, slug: string): Promise<DataGrant[]> {
    const { data } = await selectMaybeSingle(createServiceRoleClient(), 'published_files', ['data_tables'] as const, { workspace_id: workspaceId, slug })
    if (!data) throw new AppError('publishedLinkGone')
    return parseDataGrants(data.data_tables)
}

function sameTable(a: Pick<PageTable, 'database' | 'table'>, b: Pick<PageTable, 'database' | 'table'>): boolean {
    return a.database === b.database && a.table === b.table
}

// Every grant shows, whoever's database it reaches; only the databases the person reaches are
// offered. A grant on a database that could not be listed shows too, its row count unknown, so it
// is never dropped for having been out of sight.
function pageDataOf(grants: readonly DataGrant[], { tables, unlisted }: Machine): PageData {
    const strip = ({ visible: _visible, ...table }: MachineTable): PageTable => table
    const listed = grants.flatMap(grant => {
        const table = tables.find(candidate => sameTable(candidate, grant))
        if (table) return [{ ...strip(table), grant: grant.grant }]
        const database = unlisted.get(grant.database)
        return database ? [{ database: grant.database, owner: database.owner, table: grant.table, rows: null, grant: grant.grant }] : []
    })
    const others = tables.filter(table => table.visible && !grants.some(grant => grant.table === table.table)).map(strip)
    return { listed, others }
}

export async function getPageData(workspaceId: number, slug: string, visibleAgents: 'all' | Set<string>): Promise<PageData> {
    const [grants, machine] = await Promise.all([storedGrants(workspaceId, slug), machineTables(workspaceId, visibleAgents)])
    return pageDataOf(grants, machine)
}

// A person grants any table they reach. A grant already on the page that reaches a coworker they do
// not see, or a database the machine could not list, stays: they may lower it or take it away, never
// raise it nor add one there.
export async function updatePageData(workspaceId: number, slug: string, next: readonly DataGrant[], visibleAgents: 'all' | Set<string>): Promise<PageData> {
    const [current, machine] = await Promise.all([storedGrants(workspaceId, slug), machineTables(workspaceId, visibleAgents)])
    const grants = parseDataGrants(next).filter(grant => {
        const table = machine.tables.find(candidate => sameTable(candidate, grant))
        if (table?.visible) return true
        if (!table && !machine.unlisted.has(grant.database)) return false
        const before = current.find(existing => sameTable(existing, grant))
        return !!before && (before.grant === 'write' || grant.grant === 'read')
    })
    const { error } = await createServiceRoleClient()
        .from('published_files')
        .update<Database['public']['Tables']['published_files']['Update']>({ data_tables: grants })
        .eq('workspace_id', workspaceId)
        .eq('slug', slug)
    if (error) throw new Error(`Failed to update the tables of the page: ${error.message}`)
    return pageDataOf(grants, machine)
}
