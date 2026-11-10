import { beforeEach, describe, expect, it, vi } from 'vitest'

const revertBrainPageAction = vi.fn()
const cancelSubRunAction = vi.fn()
vi.mock('@/app/api/_actions/brain.actions', () => ({ revertBrainPageAction: (...args: unknown[]) => revertBrainPageAction(...args) }))
vi.mock('@/app/api/_actions/agent.actions', () => ({ cancelSubRunAction: (...args: unknown[]) => cancelSubRunAction(...args) }))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace: { id: 7 }, supabase: {} }),
}))

const revert = await import('./route')
const cancel = await import('@/app/api/v1/agents/[id]/runs/[runId]/tasks/[taskId]/cancel/route')

const request = (body?: object) => new Request('https://app.rerun.build/api/v1/x', { method: 'POST', body: body ? JSON.stringify(body) : undefined })

describe('/api/v1/brain/pages/:slug/revert', () => {
    beforeEach(() => revertBrainPageAction.mockReset().mockResolvedValue({ ok: true, detail: {} }))

    it('puts the page back to the revision it had before the change', async () => {
        const res = await revert.POST(request({ revisionId: 'rev-1', expectedHash: 'h1' }), { params: Promise.resolve({ slug: 'pricing' }) })
        expect(res.status).toBe(204)
        expect(revertBrainPageAction).toHaveBeenCalledWith('pricing', 'rev-1', 'h1')
    })

    it('says the page changed since', async () => {
        revertBrainPageAction.mockResolvedValue({ ok: false, conflict: true, error: 'This page changed since. Open it and restore a version from its history.', code: 'brainPageChangedSince' })
        const res = await revert.POST(request({ revisionId: 'rev-1' }), { params: Promise.resolve({ slug: 'pricing' }) })
        expect(res.status).toBe(409)
        expect(await res.json()).toMatchObject({ error: 'This page changed since. Open it and restore a version from its history.' })
    })
})

describe('/api/v1/agents/:id/runs/:runId/tasks/:taskId/cancel', () => {
    const segment = { params: Promise.resolve({ id: 'agent-1', runId: 'run-1', taskId: 'task-1' }) }

    it('stops one task of the delegation', async () => {
        cancelSubRunAction.mockResolvedValue(true)
        expect((await cancel.POST(request(), segment)).status).toBe(204)
        expect(cancelSubRunAction).toHaveBeenCalledWith('agent-1', 'run-1', 'task-1')
    })

    it('says when the task could not be stopped', async () => {
        cancelSubRunAction.mockResolvedValue(false)
        expect((await cancel.POST(request(), segment)).status).toBe(503)
    })
})
