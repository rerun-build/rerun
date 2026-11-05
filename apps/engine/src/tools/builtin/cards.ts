import { tool, type ToolSet } from 'ai'
import { basename, isAbsolute, relative } from 'node:path'
import { stat } from 'node:fs/promises'
import { z } from 'zod'
import { CARD_MAX_FILES, type FileCard, type FileCardEntry } from '@rerun/contracts'
import { AGENT_HIDDEN_TABLES, getAgentDb } from '../../db/agentDb.js'
import { getSharedDb, SHARED_HIDDEN_TABLES } from '../../db/sharedDb.js'
import { deleteView, findView, listViews, saveView } from '../../db/tableViews.js'
import { sharedDir, workspaceDir } from '../../config/paths.js'
import { resolveWithinReal } from '../sandbox.js'
import type { RunContext } from '../../runtime/context.js'
import { buildTableCard, tableCardInput, tableDisplayInput, tableTargetInput } from './table-card.js'
import { jsonTolerantArray } from './hitl.js'

export function cardTools(ctx: RunContext): ToolSet {
    const agentId = ctx.agent.id
    const database = async (scope: 'agent' | 'shared') =>
        scope === 'shared' ? { client: await getSharedDb(), hidden: SHARED_HIDDEN_TABLES } : { client: await getAgentDb(agentId), hidden: AGENT_HIDDEN_TABLES }

    return {
        card_table: tool({
            description:
                'Show the user a preview card of one of the views saved on a table: its first rows, drawn the way that view draws them, plus a button that opens the table on that tab. Use it right after you filled or updated a table, so they can see the result without leaving the conversation. A card only shows a saved view: when the table has none yet, or none showing the rows you mean, save one first with table_view_save. This is a display tool, not a way to read data: to actually look at rows yourself, call db_query or shared_db_query.',
            inputSchema: tableCardInput,
            execute: async ({ scope, table, view: viewName, limit }) => {
                try {
                    const { client, hidden } = await database(scope)
                    const view = await findView(client, table, viewName, hidden)
                    if (!view) {
                        const names = (await listViews(client, table, hidden)).map(v => v.name)
                        throw new Error(
                            names.length
                                ? `No view named "${viewName}" on ${table}. Its views: ${names.join(', ')}`
                                : `${table} has no saved view yet. Save one with table_view_save, then pass its name in view.`
                        )
                    }
                    const { id: _id, table: _table, name, position: _position, ...config } = view
                    return JSON.stringify(await buildTableCard(client, { ...config, scope, table, view: name, limit }, { hidden, workspace: workspaceDir(agentId) }))
                } catch (e) {
                    return `Could not show that table: ${(e as Error).message}`
                }
            },
        }),
        table_view_save: tool({
            description:
                'Save a view of one of your tables: a named way to draw it (table, list, gallery or board) and which rows it shows, that the user finds as a tab when they open the table in the app, and the only thing card_table can show. Save one right after creating a table the user will browse, and another for each selection worth showing on its own (the top leads, the open deals). Saving under an existing name replaces that view. Only change or delete a view the user made when they ask.',
            inputSchema: z.object({
                ...tableTargetInput,
                name: z.string().min(1).max(60).describe('Name of the view, shown as its tab, e.g. "Pipeline" or "Catalog"'),
                ...tableDisplayInput,
            }),
            execute: async ({ scope, table, ...input }) => {
                try {
                    const { client, hidden } = await database(scope)
                    const view = await saveView(client, table, { ...input, layout: input.layout ?? 'table' }, { hidden, replaceByName: true })
                    return `Saved the ${view.layout} view "${view.name}" on ${table}. The user sees it as a tab of the table in the app; show it in the chat with card_table and view "${view.name}".`
                } catch (e) {
                    return `Could not save that view: ${(e as Error).message}`
                }
            },
        }),
        table_view_delete: tool({
            description: 'Delete a saved view of one of your tables, by name. The rows are untouched.',
            inputSchema: z.object({ ...tableTargetInput, name: z.string().describe('Name of the view to delete') }),
            execute: async ({ scope, table, name }) => {
                try {
                    const { client } = await database(scope)
                    return (await deleteView(client, table, name)) ? `Deleted the view "${name}" of ${table}.` : `${table} has no view named "${name}".`
                } catch (e) {
                    return `Could not delete that view: ${(e as Error).message}`
                }
            },
        }),
        card_file: tool({
            description:
                'Show the user one or several files as preview tiles in the conversation, which they can click to open. Use it when you produced or updated files they should look at, and always before you ask them to review, approve or choose among files: every candidate of a choice (the three images, the slides of a carousel) goes in the same call, in the order you will refer to them. A file of your workspace takes scope \'agent\', a file of the shared space (one a sub-coworker or another coworker wrote there) takes scope \'shared\'. This does not read the files for you: use fs_read or shared_read for that.',
            inputSchema: z.object({
                files: jsonTolerantArray(
                    z
                        .array(
                            z.object({
                                path: z.string().describe('Path of the file, relative to the root of its scope'),
                                scope: z.enum(['agent', 'shared']).optional().describe("'agent' for your workspace (the default), 'shared' for the shared space"),
                            })
                        )
                        .min(1)
                        .max(CARD_MAX_FILES)
                ).describe('The files to show together, in the order the user should see them'),
            }),
            execute: async ({ files }) => {
                const shown: FileCardEntry[] = []
                const failures: string[] = []
                for (const { path, scope } of files) {
                    try {
                        shown.push(await fileCardEntry(agentId, path, scope))
                    } catch (e) {
                        failures.push(`${path}: ${(e as Error).message}`)
                    }
                }
                if (failures.length) return `Could not show ${failures.length === 1 ? 'that file' : 'those files'}, nothing was shown:\n${failures.join('\n')}`
                const card: FileCard = { kind: 'file', files: shown }
                return JSON.stringify(card)
            },
        }),
    }
}

// The foreman shows the files it made, but has no table panel for card_table or a saved view to open.
export function foremanCardTools(ctx: RunContext): ToolSet {
    const { card_file } = cardTools(ctx)
    return { card_file }
}

const inside = (root: string, path: string) => isAbsolute(path) && !relative(root, path).startsWith('..')

// A path the model copied from a shared_ or fs_ listing is absolute and names its own root, whatever
// scope it was given.
function scopeOf(agentId: string, path: string, scope: FileCardEntry['scope'] | undefined): FileCardEntry['scope'] {
    if (inside(sharedDir(), path)) return 'shared'
    if (inside(workspaceDir(agentId), path)) return 'agent'
    return scope ?? 'agent'
}

async function fileCardEntry(agentId: string, path: string, requestedScope: FileCardEntry['scope'] | undefined): Promise<FileCardEntry> {
    const scope = scopeOf(agentId, path, requestedScope)
    const root = scope === 'shared' ? sharedDir() : workspaceDir(agentId)
    const absolute = await resolveWithinReal(root, path)
    const info = await stat(absolute)
    if (info.isDirectory()) throw new Error('it is a folder, not a file. Point to a file inside it.')
    // The chat opens files through the app's own proxy, which addresses them relative to the root
    // of their scope. An absolute engine path there is a 404.
    return { path: relative(root, absolute), name: basename(absolute), size: info.size, scope }
}
