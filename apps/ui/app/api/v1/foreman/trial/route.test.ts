import { describe, expect, it, vi } from 'vitest'

const workspace = { id: 7, subscription_status: null as string | null }

vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace, role: 'admin', supabase: {} }),
    requireAdminContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace, role: 'admin', supabase: {} }),
}))

const { POST } = await import('./route')

const segment = { params: Promise.resolve({}) }
const request = (client?: string) => new Request('https://moldwright.robagentic.tech/api/v1/foreman/trial', { method: 'POST', headers: client ? { 'x-rerun-client': client } : {} })

describe('POST /api/v1/foreman/trial', () => {
    it('answers that the workspace is on, since this install sells no plan', async () => {
        const res = await POST(request(), segment)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ entitled: true })
    })
})
