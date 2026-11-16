import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { request, supportsForemanWakes } from '@/lib/engine/client'
import { sendForemanSignal } from './signal'

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ request: vi.fn(async () => ({ queued: true })), supportsForemanWakes: vi.fn(async () => true) }))

const conn = { baseUrl: 'https://box.test', apiKey: 'k' }

describe('sendForemanSignal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(findWorkspaceEngine).mockResolvedValue({ conn } as never)
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    })

    it("queues the signal on the Chief of Staff's box", async () => {
        await sendForemanSignal(7, { kind: 'member_joined', summary: 'Ada joined' })
        expect(request).toHaveBeenCalledWith(conn, '/agents/foreman/wake/signals', { method: 'POST', body: JSON.stringify({ kind: 'member_joined', summary: 'Ada joined' }) }, expect.any(Function))
    })

    it('skips a box without wakes or without a machine', async () => {
        vi.mocked(supportsForemanWakes).mockResolvedValueOnce(false)
        await sendForemanSignal(7, { kind: 'x', summary: 'y' })
        vi.mocked(findWorkspaceEngine).mockResolvedValueOnce(null)
        await sendForemanSignal(7, { kind: 'x', summary: 'y' })
        expect(request).not.toHaveBeenCalled()
    })

    // It never stands in the way of what caused it.
    it('swallows a box that cannot be reached', async () => {
        vi.mocked(request).mockRejectedValueOnce(new Error('down'))
        await expect(sendForemanSignal(7, { kind: 'x', summary: 'y' })).resolves.toBeUndefined()
    })
})
