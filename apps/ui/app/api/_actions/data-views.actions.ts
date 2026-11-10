'use server'

import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import { getAgentChatTarget } from '@/app/api/_services/chat.service'
import * as engine from '@/lib/engine/client'
import type { DataScope } from '@/lib/data/source'
import type { EngineConnection } from '@/lib/engine/types'
import type { EngineDbGroup, TableSourcesRequest, TableSourcesResult, TableView, TableViewInput } from '@rerun/contracts'
import { refusal, type ActionRefusal, type ErrorCode } from '@/lib/i18n/action-error'

type ActionResult<T = object> = ({ success: true } & T) | ({ success: false } & ActionRefusal)

// The views, groups and row edits of a table, for both databases a workspace has: an agent's private
// one and the one its agents share. Ownership is settled here, in the scope, never by the caller.
async function resolve(scope: DataScope): Promise<{ conn: EngineConnection; base: string }> {
    if (scope.kind === 'shared') return { conn: await requireWorkspaceConnection(), base: engine.SPACE_DATA_BASE }
    const { conn, engineAgentId } = await getAgentChatTarget(scope.agentId)
    return { conn, base: engine.agentDataBase(engineAgentId) }
}

// The engine answers `{ error }` with a 400 for a refusal it can explain, and a bare 404 when it
// predates these routes: the machine is fine, it just needs the update.
function describe(err: unknown, fallback: ErrorCode): ActionRefusal {
    const message = err instanceof Error ? err.message : ''
    if (/failed: 404\b/.test(message)) return refusal('dataNeedsEngineUpdate')
    const body = /failed: \d+ (\{[\s\S]*\})$/.exec(message)?.[1]
    if (body) {
        try {
            const parsed = JSON.parse(body) as { error?: unknown }
            if (typeof parsed.error === 'string' && parsed.error) return { error: parsed.error }
        } catch {}
    }
    return refusal(fallback)
}

export async function listTableViewsAction(scope: DataScope, table: string): Promise<ActionResult<{ views: TableView[] }>> {
    try {
        const { conn, base } = await resolve(scope)
        return { success: true, views: await engine.listTableViews(conn, base, table) }
    } catch (err) {
        return { success: false, ...describe(err, 'readViewsFailed') }
    }
}

export async function saveTableViewAction(scope: DataScope, table: string, input: TableViewInput, id?: string): Promise<ActionResult<{ view: TableView }>> {
    try {
        const { conn, base } = await resolve(scope)
        return { success: true, view: await engine.saveTableView(conn, base, table, input, id) }
    } catch (err) {
        return { success: false, ...describe(err, 'saveViewFailed') }
    }
}

export async function deleteTableViewAction(scope: DataScope, table: string, id: string): Promise<ActionResult> {
    try {
        const { conn, base } = await resolve(scope)
        await engine.deleteTableView(conn, base, table, id)
        return { success: true }
    } catch (err) {
        return { success: false, ...describe(err, 'deleteViewFailed') }
    }
}

export async function readTableGroupsAction(scope: DataScope, table: string, params: engine.ReadDbTableGroupsParams): Promise<ActionResult<{ groups: EngineDbGroup[] }>> {
    try {
        const { conn, base } = await resolve(scope)
        return { success: true, groups: await engine.readDbTableGroups(conn, base, table, params) }
    } catch (err) {
        return { success: false, ...describe(err, 'groupRowsFailed') }
    }
}

export async function updateTableRowAction(scope: DataScope, table: string, rowid: number | string, values: Record<string, string | number | boolean | null>): Promise<ActionResult<{ row: Record<string, unknown> }>> {
    try {
        const { conn, base } = await resolve(scope)
        return { success: true, row: await engine.updateDbTableRow(conn, base, table, rowid, values) }
    } catch (err) {
        return { success: false, ...describe(err, 'saveRowFailed') }
    }
}

// Null on any failure, a 404 from an engine that predates the route included: the provenance of the
// rows is a hint over the table, never a reason to show an error.
export async function readTableSourcesAction(scope: DataScope, rows: TableSourcesRequest['rows']): Promise<TableSourcesResult | null> {
    try {
        const { conn, base } = await resolve(scope)
        return await engine.readTableSources(conn, base, rows)
    } catch {
        return null
    }
}
