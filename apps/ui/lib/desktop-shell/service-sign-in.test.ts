import type { DesktopOAuthReturn } from '@rerun/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopShell } from './client'
import { signInThroughBrowser } from './service-sign-in'

vi.mock('./client', () => ({ desktopShell: vi.fn() }))

const START_URL = 'https://app.rerun.build/api/oauth/mobile/start?t=ticket'

let returnTo: ((result: DesktopOAuthReturn) => void) | null = null
const openExternal = vi.fn(async () => {
    returnTo?.({ status: 'success', claim: 'row-1-claim-0000' })
    return true
})
const fetchMock = vi.fn(async (url: string) => (url.endsWith('/connect') ? Response.json({ url: START_URL, returnUrl: 'rerun-desktop://oauth/callback' }) : new Response(null, { status: 204 })))

beforeEach(() => {
    vi.clearAllMocks()
    returnTo = null
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(desktopShell).mockReturnValue({
        links: { openExternal },
        oauth: {
            onReturn: (cb: (result: DesktopOAuthReturn) => void) => {
                returnTo = cb
                return () => {
                    returnTo = null
                }
            },
        },
    } as never)
})

afterEach(() => vi.unstubAllGlobals())

describe('signInThroughBrowser', () => {
    it('signs a Vault entry in through the system browser, then claims the token for the entry', async () => {
        const result = await signInThroughBrowser({ vaultItemId: 'item-1' }, 'failed')

        expect(result).toEqual({ ok: true })
        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/vault/item-1/connect', { method: 'POST' })
        expect(openExternal).toHaveBeenCalledWith(START_URL)
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/vault/item-1/authorized', expect.objectContaining({ method: 'POST', body: JSON.stringify({ claim: 'row-1-claim-0000' }) }))
    })

    it("keeps a coworker's server on its own routes", async () => {
        await signInThroughBrowser({ agentId: 'agent-1', server: 'notion' }, 'failed')

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/agents/agent-1/mcp/notion/connect', { method: 'POST' })
    })
})
