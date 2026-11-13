import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-hub-tools-'))
process.env.RERUN_API_KEY = ''

const calls = vi.hoisted(() => [] as Array<{ agentId: string; tool: string; args: Record<string, unknown>; timeoutMs?: number }>)

vi.mock('../../runtime/hub.js', () => ({
    callHub: async (caller: { id: string }, tool: string, args: Record<string, unknown>, timeoutMs?: number) => {
        calls.push({ agentId: caller.id, tool, args, timeoutMs })
        if (tool === 'service_uninstall') throw new Error('Hub call failed (404)')
        return { tool }
    },
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { hubTools } = await import('./hub.js')

const tools = hubTools({ agent: { id: 'hub-agent' } } as any)

function run(name: string, args: Record<string, unknown>) {
    return (tools[name] as any).execute(args, { toolCallId: 'c', messages: [] })
}

beforeEach(() => {
    calls.length = 0
})

describe('hubTools', () => {
    it.each([
        ['rerun_hub_service_search', { query: 'send email', category: 'mail' }, 'service_search', { query: 'send email', category: 'mail' }],
        ['rerun_hub_service_details', { slug: 'stripe' }, 'service_details', { slug: 'stripe' }],
        ['rerun_hub_service_install', { slug: 'stripe', values: { region: 'eu' } }, 'service_install', { slug: 'stripe', values: { region: 'eu' } }],
        ['rerun_hub_service_list_installed', {}, 'service_list_installed', {}],
        ['rerun_hub_publish_file', { path: 'r.html', slug: 'report' }, 'publish_file', { path: 'r.html', slug: 'report', access: undefined, invite: undefined, password: undefined }],
        [
            'rerun_hub_publish_file',
            { path: 'q3/', access: 'invited', invite: ['marie@northwind.com', '@northwind.com'] },
            'publish_file',
            { path: 'q3/', slug: undefined, access: 'invited', invite: ['marie@northwind.com', '@northwind.com'], password: undefined },
        ],
        ['rerun_hub_unpublish_file', { slug: 'report' }, 'unpublish_file', { path: undefined, slug: 'report' }],
        ['rerun_hub_list_published', {}, 'list_published', {}],
        ['rerun_hub_search_docs', { query: 'webhook trigger token' }, 'search_docs', { query: 'webhook trigger token' }],
    ])('%s calls the hub tool with its arguments', async (name, args, hubTool, hubArgs) => {
        expect(await run(name, args)).toEqual({ tool: hubTool })
        expect(calls).toEqual([{ agentId: 'hub-agent', tool: hubTool, args: hubArgs, timeoutMs: undefined }])
    })

    it('forwards only the arguments each tool declares', async () => {
        await run('rerun_hub_service_search', { query: 'q', extra: 'dropped' })
        expect(calls[0].args).toEqual({ query: 'q', category: undefined })
    })

    it('lets a hub failure reach the caller', async () => {
        await expect(run('rerun_hub_service_uninstall', { slug: 'stripe' })).rejects.toThrow('Hub call failed (404)')
        expect(calls[0]).toMatchObject({ tool: 'service_uninstall', args: { slug: 'stripe' } })
    })

    it('exposes exactly the catalog, publishing and documentation tools', () => {
        expect(Object.keys(tools)).toEqual([
            'rerun_hub_service_search',
            'rerun_hub_service_details',
            'rerun_hub_service_install',
            'rerun_hub_service_list_installed',
            'rerun_hub_service_uninstall',
            'rerun_hub_publish_file',
            'rerun_hub_unpublish_file',
            'rerun_hub_list_published',
            'rerun_hub_search_docs',
        ])
    })
})
