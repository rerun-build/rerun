import { requireWorkspaceConnection } from '@/app/api/_auth/workspace-target'
import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import * as engine from '@/lib/engine/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTableSourcesAction } from './data-views.actions'

vi.mock('@/app/api/_auth/workspace-target', () => ({ requireWorkspaceConnection: vi.fn() }))
vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ SPACE_DATA_BASE: '/shared/data', agentDataBase: (id: string) => `/agents/${id}/data`, readTableSources: vi.fn() }))

const conn = { baseUrl: 'https://engine.test', apiKey: 'box-key' }
const rows = [{ email: 'paul@chezpaul.fr' }]

describe('readTableSourcesAction', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(requireWorkspaceConnection).mockResolvedValue(conn as never)
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn, engineAgentId: 'engine-agent' } as never)
    })

    it('asks the database of the scope', async () => {
        const result = { calls: {}, rows: [{ sources: [], cells: {} }] }
        vi.mocked(engine.readTableSources).mockResolvedValue(result)
        await expect(readTableSourcesAction({ kind: 'agent', agentId: 'a1' }, rows)).resolves.toEqual(result)
        expect(engine.readTableSources).toHaveBeenCalledWith(conn, '/agents/engine-agent/data', rows)
        await readTableSourcesAction({ kind: 'shared' }, rows)
        expect(engine.readTableSources).toHaveBeenLastCalledWith(conn, '/shared/data', rows)
    })

    it('answers null for an engine that predates the route', async () => {
        vi.mocked(engine.readTableSources).mockRejectedValue(new Error('rerun-engine POST /shared/data/sources failed: 404 Not Found'))
        await expect(readTableSourcesAction({ kind: 'shared' }, rows)).resolves.toBeNull()
    })

    it('answers null when the scope cannot be reached', async () => {
        vi.mocked(resolveAgentTarget).mockRejectedValue(new Error('No agent'))
        await expect(readTableSourcesAction({ kind: 'agent', agentId: 'gone' }, rows)).resolves.toBeNull()
        expect(engine.readTableSources).not.toHaveBeenCalled()
    })
})
