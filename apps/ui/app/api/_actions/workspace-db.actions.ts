'use server'

import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import { NoEngineError } from '@/app/api/_services/workspace-engine.service'
import * as engine from '@/lib/engine/client'
import type { ReadDbTableRowsParams } from '@/lib/engine/client'
import type { TableListResult } from '@/lib/data/source'
import type { EngineDbRows } from '@/lib/engine/types'
import { refusal, refusalOf, type ErrorCode, type ActionRefusal, type SuccessResult } from '@/lib/i18n/action-error'

// An engine that predates the shared database answers a bare 404 on this route, which reads as
// "unreachable" unless we name it: the workspace is fine, its machine is just behind.
function describe(err: unknown, fallback: ErrorCode): ActionRefusal {
    const message = err instanceof Error ? err.message : ''
    if (/failed: 404\b/.test(message)) return refusal('sharedDbNeedsEngineUpdate')
    return message ? refusalOf(err) : refusal(fallback)
}

// Resolving the workspace fails with messages written for the user (not a member, signed out); the
// engine call fails with transport details that are not.
export async function listWorkspaceTablesAction(): Promise<TableListResult> {
    let conn: Awaited<ReturnType<typeof requireWorkspaceConnection>>
    try {
        conn = await requireWorkspaceConnection()
    } catch (err) {
        if (err instanceof NoEngineError) return { success: true, tables: [] }
        return { success: false, ...(err instanceof Error && err.message ? refusalOf(err) : refusal('workspaceMachineUnreachable')) }
    }
    try {
        return { success: true, tables: await engine.listDbTables(conn, engine.SPACE_DATA_BASE) }
    } catch (err) {
        const message = err instanceof Error ? err.message : ''
        return { success: false, ...refusal(/failed: 404\b/.test(message) ? 'sharedDbNeedsEngineUpdate' : 'workspaceMachineUnreachable') }
    }
}

export async function readWorkspaceTableRowsAction(table: string, params: ReadDbTableRowsParams): Promise<EngineDbRows | null> {
    try {
        const conn = await requireWorkspaceConnection()
        return await engine.readDbTableRows(conn, engine.SPACE_DATA_BASE, table, params)
    } catch {
        return null
    }
}

export async function deleteWorkspaceTableRowsAction(table: string, rowids: (number | string)[]): Promise<SuccessResult & { deleted?: number }> {
    try {
        const conn = await requireWorkspaceConnection()
        const { deleted } = await engine.deleteDbTableRows(conn, engine.SPACE_DATA_BASE, table, rowids)
        return { success: true, deleted }
    } catch (err) {
        return { success: false, ...describe(err, 'deleteRowsFailed') }
    }
}

export async function dropWorkspaceTableAction(table: string): Promise<SuccessResult> {
    try {
        const conn = await requireWorkspaceConnection()
        await engine.dropDbTable(conn, engine.SPACE_DATA_BASE, table)
        return { success: true }
    } catch (err) {
        return { success: false, ...describe(err, 'deleteTableFailed') }
    }
}

export async function purgeWorkspaceTableAction(table: string): Promise<SuccessResult & { deleted?: number }> {
    try {
        const conn = await requireWorkspaceConnection()
        const { deleted } = await engine.purgeDbTable(conn, engine.SPACE_DATA_BASE, table)
        return { success: true, deleted }
    } catch (err) {
        return { success: false, ...describe(err, 'purgeTableFailed') }
    }
}
