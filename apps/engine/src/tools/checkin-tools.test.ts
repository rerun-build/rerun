import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-checkin-tools-'))
process.env.RERUN_REMOTE_COMPUTERS = 'on'

const { beforeAll, describe, expect, it } = await import('vitest')
const { FOREMAN_AGENT_ID, foremanBriefSchema } = await import('@rerun/contracts')
const { migrate } = await import('../db/migrate.js')
const { ensureForeman } = await import('../agents/foreman.js')
const { getAgent } = await import('../agents/registry.js')
const { buildTools, CHECKIN_TOOL_NAMES } = await import('./registry.js')
const { logger } = await import('../lib/logger.js')
const { upsertComputer } = await import('../remote/store.js')

const brief = foremanBriefSchema.parse({
    instructions: 'Charter.',
    tools: [
        { name: 'list_agents', description: 'List agents.', inputSchema: { type: 'object', properties: {} }, kind: 'hub' },
        { name: 'focus_agent', description: 'Open a panel.', inputSchema: { type: 'object', properties: {} }, kind: 'intent' },
    ],
})

// Every tool the Chief of Staff holds in a conversation that a check-in must never get. A tool added
// to it later is in neither list and fails the first test until someone decides which it is.
const REFUSED_IN_A_CHECKIN = new Set([
    'fs_write',
    'fs_edit',
    'shared_write',
    'shared_edit',
    'agent_files_write',
    'agent_files_edit',
    'shell_exec',
    'download',
    'memory_write',
    'memory_delete',
    'shared_db_execute',
    'skill_create',
    'skill_import',
    'skill_edit',
    'skill_update',
    'skill_delete',
    'skill_write_file',
    'skill_delete_file',
    'skill_propose',
    'verbosity_set',
    'schedule_create',
    'schedule_update',
    'schedule_edit',
    'schedule_delete',
    'brain_write',
    'brain_delete',
    'brain_decide',
    'delegate_tasks',
    'browser_navigate',
    'vision_analyze',
    'ask_user',
    'request_approval',
    'card_file',
    'remote_computers',
    'remote_exec',
    'remote_file_list',
    'remote_file_read',
    'remote_file_write',
    'remote_job',
    'remote_transfer',
    'request_computer_access',
    'focus_agent',
])

async function toolNames(readOnly: boolean, provider = 'rerun'): Promise<string[]> {
    const agent = { ...(await getAgent(FOREMAN_AGENT_ID)), brief }
    const { tools, close } = await buildTools({ agent, sessionId: 's1', logger, provider: provider as 'rerun', model: 'rerun-max', readOnly })
    await close()
    return Object.keys(tools).sort()
}

describe('the tools of a check-in', () => {
    beforeAll(async () => {
        await migrate()
        await ensureForeman()
        await upsertComputer({ id: 'c1', handle: 'studio-pc', name: 'Studio PC' })
    })

    it('classifies every tool the Chief of Staff holds as allowed or refused in a check-in', async () => {
        const unclassified = (await toolNames(false)).filter(name => !CHECKIN_TOOL_NAMES.has(name) && !REFUSED_IN_A_CHECKIN.has(name) && name !== 'list_agents')
        expect(unclassified).toEqual([])
    })

    it('keeps only the reads of the box and the hub tools of its brief', async () => {
        const names = await toolNames(true)
        for (const name of names) expect(CHECKIN_TOOL_NAMES.has(name) || name === 'list_agents').toBe(true)
        expect(names).toEqual(expect.arrayContaining(['fs_read', 'agent_files_read', 'web_fetch', 'memory_recall', 'skill_read', 'brain_search', 'schedule_list', 'shared_db_query', 'list_agents']))
    })

    it('gets no shell, no sub-coworker, no card, no write and no board gesture', async () => {
        const names = await toolNames(true)
        for (const name of REFUSED_IN_A_CHECKIN) expect(names).not.toContain(name)
    })

    it('leaves the search to a CLI, which searches on its own subscription', async () => {
        expect(await toolNames(true, 'claude')).not.toContain('web_search')
        expect(await toolNames(true, 'claude')).toContain('web_fetch')
    })
})
