import { beforeEach, describe, expect, it, vi } from 'vitest'

const openDesktopAction = vi.fn()
const startTakeoverAction = vi.fn()
const finishTakeoverAction = vi.fn()
vi.mock('@/app/api/_actions/desktop.actions', () => ({
    openDesktopAction: (...args: unknown[]) => openDesktopAction(...args),
    startTakeoverAction: (...args: unknown[]) => startTakeoverAction(...args),
    finishTakeoverAction: (...args: unknown[]) => finishTakeoverAction(...args),
}))
vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => ({ userId: 'user-1', authUser: { id: 'user-1' }, workspace: { id: 7 }, supabase: {} }),
}))

const desktop = await import('./route')
const takeover = await import('./takeover/route')

const segment = { params: Promise.resolve({ id: 'agent-1' }) }
const request = (method: string, body?: object, search = '') => new Request(`https://app.rerun.build/api/v1/agents/agent-1/desktop${search}`, { method, body: body ? JSON.stringify(body) : undefined })

describe('/api/v1/agents/:id/desktop', () => {
    beforeEach(() => {
        openDesktopAction.mockReset().mockResolvedValue({ ok: true, socketUrl: 'wss://relay/box/30/desktop/ws?ticket=t', dock: true })
        startTakeoverAction.mockReset().mockResolvedValue({ ok: true })
        finishTakeoverAction.mockReset().mockResolvedValue({ ok: true, url: 'https://linear.app/login' })
    })

    it('hands back a socket to the screen, in the mode asked', async () => {
        const res = await desktop.POST(request('POST', { mode: 'drive', timeZone: 'Europe/Paris' }), segment)
        expect(await res.json()).toEqual({ socketUrl: 'wss://relay/box/30/desktop/ws?ticket=t', dock: true })
        expect(openDesktopAction).toHaveBeenCalledWith('agent-1', 'drive', 'Europe/Paris')
    })

    it('says why a machine has no screen to show', async () => {
        openDesktopAction.mockResolvedValue({ ok: false, error: 'The screen arrives with the next update of this machine.' })
        const res = await desktop.POST(request('POST', { mode: 'watch' }), segment)
        expect(res.status).toBe(503)
        expect(await res.json()).toMatchObject({ error: 'The screen arrives with the next update of this machine.' })
    })

    it('reads a coworker of a Box the member cannot see as missing', async () => {
        openDesktopAction.mockResolvedValue({ ok: false, error: 'Coworker not found', code: 'coworkerNotFound', denied: 'not_found' })
        expect((await desktop.POST(request('POST', { mode: 'watch' }), segment)).status).toBe(404)
        startTakeoverAction.mockResolvedValue({ ok: false, error: 'Coworker not found', code: 'coworkerNotFound', denied: 'not_found' })
        expect((await takeover.POST(request('POST', {}), segment)).status).toBe(404)
    })

    it('opens the coworker’s browser for the person, then gives back where it was left', async () => {
        expect((await takeover.POST(request('POST', { url: 'https://linear.app/login' }), segment)).status).toBe(204)
        expect(startTakeoverAction).toHaveBeenCalledWith('agent-1', 'https://linear.app/login')
        expect(await (await takeover.DELETE(request('DELETE'), segment)).json()).toEqual({ url: 'https://linear.app/login' })
        expect(finishTakeoverAction).toHaveBeenCalledWith('agent-1', { keepOpen: false })
    })

    it('leaves the window on the coworker’s screen when the person hands it back to the run', async () => {
        finishTakeoverAction.mockResolvedValue({ ok: true, url: 'https://web.whatsapp.com/', open: true })
        expect(await (await takeover.DELETE(request('DELETE', undefined, '?keepOpen=1'), segment)).json()).toEqual({ url: 'https://web.whatsapp.com/', open: true })
        expect(finishTakeoverAction).toHaveBeenCalledWith('agent-1', { keepOpen: true })
    })
})
