import { beforeEach, describe, expect, it, vi } from 'vitest'

const cancelSubRunAction = vi.fn()
vi.mock('@/app/api/_actions/agent.actions', () => ({ cancelSubRunAction: (...args: unknown[]) => cancelSubRunAction(...args) }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace: { id: 7 }, supabase: {} }),
}))

const { POST } = await import('./route')

const cancel = (runId: string, taskId: string) => POST(new Request('https://moldwright.robagentic.tech/api/v1/agents/agent-1/runs/x/tasks/y/cancel', { method: 'POST' }), { params: Promise.resolve({ id: 'agent-1', runId, taskId }) })

describe('POST /api/v1/agents/:id/runs/:runId/tasks/:taskId/cancel', () => {
    beforeEach(() => cancelSubRunAction.mockReset().mockResolvedValue(true))

    it('stops the task named', async () => {
        expect((await cancel('run_1', 'call_abc')).status).toBe(204)
        expect(cancelSubRunAction).toHaveBeenCalledWith('agent-1', 'run_1', 'call_abc')
    })

    it('never lets a path-shaped id reach the engine', async () => {
        expect((await cancel('../../../update?', 'x')).status).toBe(404)
        expect((await cancel('run_1', 'a/b')).status).toBe(404)
        expect(cancelSubRunAction).not.toHaveBeenCalled()
    })
})
