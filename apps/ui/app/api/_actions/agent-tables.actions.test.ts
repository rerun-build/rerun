import { beforeEach, describe, expect, it, vi } from 'vitest'

// The database tab of a coworker reads its table list here. A failed read once came back as an
// empty list, which the tab drew as "No tables yet" for a coworker whose table was right there.

const mocks = vi.hoisted(() => ({ getAgentChatTarget: vi.fn(), listDbTables: vi.fn() }))

vi.mock('@/app/api/_services/chat.service', () => ({ getAgentChatTarget: mocks.getAgentChatTarget, resolveRunTarget: vi.fn(), sessionRowOf: vi.fn() }))
vi.mock('@/lib/engine/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/engine/client')>()), listDbTables: mocks.listDbTables }))

const { NoEngineError } = await import('@/app/api/_services/workspace-engine.service')
const { AuthorizationError } = await import('@/app/api/_auth/ownership')
const { EngineRequestError } = await import('@/lib/engine/client')
const { listAgentTablesAction } = await import('./agent.actions')

const target = { conn: { baseUrl: 'https://engine.test', apiKey: 'box-key' }, engineAgentId: 'cog1', contentLocked: false }
const prospects = { name: 'prospects', columns: [{ name: 'id', type: 'INTEGER', pk: true, notnull: false }] }

beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAgentChatTarget.mockResolvedValue(target)
})

describe('listAgentTablesAction', () => {
    it("lists the coworker's own tables", async () => {
        mocks.listDbTables.mockResolvedValue([prospects])
        await expect(listAgentTablesAction('agent-1')).resolves.toEqual({ success: true, tables: [prospects] })
        expect(mocks.listDbTables).toHaveBeenCalledWith(target.conn, '/agents/cog1/data')
    })

    it('reads a workspace without a machine yet as an empty database', async () => {
        mocks.getAgentChatTarget.mockRejectedValue(new NoEngineError())
        await expect(listAgentTablesAction('agent-1')).resolves.toEqual({ success: true, tables: [] })
    })

    it('reports an engine that does not answer instead of an empty list', async () => {
        mocks.listDbTables.mockRejectedValue(new TypeError('fetch failed'))
        await expect(listAgentTablesAction('agent-1')).resolves.toEqual({ success: false, error: 'Could not reach the engine for this coworker.', code: 'agentDbUnreachable' })
    })

    it('keeps the transport details of a failed engine call out of the message', async () => {
        mocks.listDbTables.mockRejectedValue(new EngineRequestError('rerun-engine GET /agents/cog1/data/tables failed: 500 boom', 500))
        await expect(listAgentTablesAction('agent-1')).resolves.toEqual({ success: false, error: 'Could not reach the engine for this coworker.', code: 'agentDbUnreachable' })
    })

    it('passes on why the coworker cannot be reached', async () => {
        mocks.getAgentChatTarget.mockRejectedValue(new Error('This coworker is inactive: your plan has no free coworker slot. Activate it from the coworker panel.'))
        await expect(listAgentTablesAction('agent-1')).resolves.toEqual({
            success: false,
            error: 'This coworker is inactive: your plan has no free coworker slot. Activate it from the coworker panel.',
        })
        mocks.getAgentChatTarget.mockRejectedValue(new AuthorizationError('coworkerNotFound'))
        await expect(listAgentTablesAction('agent-1')).resolves.toEqual({ success: false, error: 'Coworker not found', code: 'coworkerNotFound' })
    })
})
