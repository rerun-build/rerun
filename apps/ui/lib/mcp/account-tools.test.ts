import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chat as engineChat } from '@/lib/engine/client'
import { dispatchAccountTool } from '@/app/api/_services/mcp-account.service'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { ACCOUNT_TOOL_DEFS, ACCOUNT_TOOL_NAMES } from './account-tools'

vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client')
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(), getConnectionForAgent: vi.fn(), getWorkspaceConnection: vi.fn() }))
vi.mock('@/app/api/_services/agent.service', () => ({ changeAgentHandle: vi.fn(), createAgent: vi.fn(), deleteAgent: vi.fn(), duplicateAgent: vi.fn(), moveAgentToBox: vi.fn(), renameAgent: vi.fn() }))
vi.mock('@/app/api/_services/agent-setup.service', () => ({ declareService: vi.fn(), installServiceSlugs: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ ensureSessionRow: vi.fn(), resolveAgentTarget: vi.fn() }))
vi.mock('@/app/api/_services/services.service', () => ({ allocateServiceInstance: vi.fn(), listCatalogServices: vi.fn(), listInstalledServices: vi.fn(), loadManifest: vi.fn(), searchCatalogServices: vi.fn(), toAuthMethodSummaries: vi.fn(() => []), uninstallService: vi.fn() }))
vi.mock('@/app/api/_services/mcp-shares.service', () => ({ dispatchShareTool: vi.fn() }))
vi.mock('@/app/api/_services/engine-plan.service', () => ({ assertModelEntitled: vi.fn() }))

const advertisedNames: string[] = ACCOUNT_TOOL_NAMES

const handledNames = ['mcp-account.service.ts', 'mcp-shares.service.ts', 'mcp-templates.service.ts'].flatMap(file =>
    [...readFileSync(path.resolve(import.meta.dirname, '../../app/api/_services', file), 'utf8').matchAll(/case '([a-z_]+)':/g)].map(match => match[1]),
)

describe('account tool defs', () => {
    it('advertises every name once', () => {
        expect([...new Set(ACCOUNT_TOOL_NAMES)]).toHaveLength(ACCOUNT_TOOL_NAMES.length)
    })

    it('has a handler for every advertised tool', () => {
        expect(ACCOUNT_TOOL_NAMES.filter(name => !handledNames.includes(name))).toEqual([])
    })

    it('advertises every handled tool', () => {
        expect(handledNames.filter(name => !advertisedNames.includes(name))).toEqual([])
    })

    it('describes what each tool does, for the calling model', () => {
        expect(ACCOUNT_TOOL_DEFS.filter(tool => tool.description.length < 40)).toEqual([])
    })

    it('advertises the confirm flag on every tool that asks for one', () => {
        const gated = [
            'delete_agent',
            'delete_skill',
            'delete_schedule',
            'delete_trigger',
            'detach_connector',
            'delete_template',
            'remove_template_agent',
            'create_agent_share',
            'revoke_agent_share',
        ]
        const missing = gated.filter(name => {
            const tool = ACCOUNT_TOOL_DEFS.find(candidate => candidate.name === name) as { inputSchema: { properties: Record<string, { type?: string }> } } | undefined
            return tool?.inputSchema.properties.confirm?.type !== 'boolean'
        })
        expect(missing).toEqual([])
    })

    it('advertises paginated skill reference reads', () => {
        const read = ACCOUNT_TOOL_DEFS.find(tool => tool.name === 'read_skill_file') as {
            description: string
            inputSchema: { properties: { offset?: { type: string; minimum?: number } } }
        }
        expect(read.inputSchema.properties.offset).toMatchObject({ type: 'integer', minimum: 0 })
        expect(read.description).toContain('nextOffset')
    })

    it('advertises the bounds duplicate_agent enforces on count', () => {
        const duplicate = ACCOUNT_TOOL_DEFS.find(tool => tool.name === 'duplicate_agent') as {
            inputSchema: { properties: { count?: { type: string; minimum?: number; maximum?: number } }; required: readonly string[] }
        }
        expect(duplicate.inputSchema.properties.count).toMatchObject({ type: 'integer', minimum: 1, maximum: 10 })
        expect(duplicate.inputSchema.required).toEqual(['agentId'])
    })
})

describe('send_message goal', () => {
    const actor = { kind: 'workspace', workspaceId: 7 } as never
    const goal = { lastLineForms: [{ prefix: 'PR: ', rest: 'pull-url' }], turnLimit: 3 }

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: { baseUrl: 'https://engine.test', apiKey: null }, engineAgentId: 'engine-own', contentLocked: false } as never)
        vi.mocked(engineChat).mockResolvedValue(new Response('down', { status: 503 }))
    })

    it('hands a valid goal to chat()', async () => {
        await expect(dispatchAccountTool(actor, 'send_message', { agentId: 'a', message: 'hi', goal })).rejects.toThrow(/could not be reached/)
        expect(vi.mocked(engineChat).mock.calls[0][2]).toMatchObject({ goal })
    })

    it('refuses turnLimit 11 as invalid_goal without starting a run', async () => {
        await expect(dispatchAccountTool(actor, 'send_message', { agentId: 'a', message: 'hi', goal: { ...goal, turnLimit: 11 } })).rejects.toThrow(/invalid_goal/)
        expect(engineChat).not.toHaveBeenCalled()
    })

    it('names invalid_goal when the engine answers 400', async () => {
        vi.mocked(engineChat).mockResolvedValue(new Response('{"error":"invalid_goal"}', { status: 400 }))
        await expect(dispatchAccountTool(actor, 'send_message', { agentId: 'a', message: 'hi', goal })).rejects.toThrow(/invalid_goal/)
    })

    it('sends no goal key without a goal', async () => {
        await expect(dispatchAccountTool(actor, 'send_message', { agentId: 'a', message: 'hi' })).rejects.toThrow(/could not be reached/)
        expect(vi.mocked(engineChat).mock.calls[0][2]).not.toHaveProperty('goal')
    })

    it('advertises goal on send_message', () => {
        expect(ACCOUNT_TOOL_DEFS.find(tool => tool.name === 'send_message')?.inputSchema.properties).toHaveProperty('goal')
    })
})

describe('send_message model and effort', () => {
    const actor = { kind: 'workspace', workspaceId: 7 } as never

    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: { baseUrl: 'https://engine.test', apiKey: null }, engineAgentId: 'engine-own', contentLocked: false } as never)
        vi.mocked(engineChat).mockResolvedValue(new Response('down', { status: 503 }))
    })

    it('hands model and thinkingLevel to chat()', async () => {
        await expect(dispatchAccountTool(actor, 'send_message', { agentId: 'a', message: 'hi', model: 'claude-opus-4.5', thinkingLevel: 'high' })).rejects.toThrow(/could not be reached/)
        const body = vi.mocked(engineChat).mock.calls[0][2]
        expect(body).toMatchObject({ model: 'claude-opus-4.5', thinkingLevel: 'high' })
        expect(body).not.toHaveProperty('provider')
        expect(body).not.toHaveProperty('connectionId')
    })

    it('sends neither when the caller names neither', async () => {
        await expect(dispatchAccountTool(actor, 'send_message', { agentId: 'a', message: 'hi' })).rejects.toThrow(/could not be reached/)
        const body = vi.mocked(engineChat).mock.calls[0][2]
        expect(body).not.toHaveProperty('model')
        expect(body).not.toHaveProperty('thinkingLevel')
    })

    it('refuses a thinking level outside the enum and a model of 101 characters with invalid_run_model', async () => {
        await expect(dispatchAccountTool(actor, 'send_message', { agentId: 'a', message: 'hi', thinkingLevel: 'extreme' })).rejects.toThrow(/invalid_run_model: thinkingLevel/)
        await expect(dispatchAccountTool(actor, 'send_message', { agentId: 'a', message: 'hi', model: 'a'.repeat(101) })).rejects.toThrow(/invalid_run_model: model/)
        expect(engineChat).not.toHaveBeenCalled()
    })

    it('advertises model and thinkingLevel on send_message', () => {
        const properties = ACCOUNT_TOOL_DEFS.find(tool => tool.name === 'send_message')?.inputSchema.properties
        expect(properties).toHaveProperty('model')
        expect(properties).toHaveProperty('thinkingLevel')
    })
})
