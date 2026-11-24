import { AccessDeniedError } from '@/app/api/_auth/access'
import { assertCanAdd, vaultContext } from '@/app/api/_services/vault.service'
import { getVaultItem } from '@/lib/engine/vault-client'
import { verifyConnectTicket } from '@/lib/oauth/mobile-ticket'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/api/_services/vault.service', () => ({ vaultContext: vi.fn(), assertCanAdd: vi.fn() }))
vi.mock('@/lib/engine/vault-client', () => ({ getVaultItem: vi.fn() }))

const { POST } = await import('./route')

const ACTOR = { kind: 'user', userId: 'user-1', workspaceId: 7, role: 'admin', boxScope: 'all' } as const
const CONN = { baseUrl: 'https://engine.test', apiKey: null }
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 RerunDesktop/0.3.0 (mac; stable)'

const call = (id = 'item-1') => POST(new Request(`https://app.rerun.build/api/vault/${id}/connect`, { method: 'POST', headers: { host: 'app.rerun.build', 'x-forwarded-proto': 'https', 'user-agent': DESKTOP_UA } }), { params: Promise.resolve({ id }) })

beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MOBILE_OAUTH_TICKET_SECRET', 'test-secret')
    vi.mocked(vaultContext).mockResolvedValue({ actor: ACTOR, conn: CONN, coworkers: [], byEngineId: new Map() })
    vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-1', oauth: { serverName: 'notion', url: 'https://mcp.notion.com/mcp' } } as never)
})

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/vault/[id]/connect', () => {
    it("hands the desktop app a sign-in for the browser, its ticket naming the entry and the member, and the app's return scheme", async () => {
        const res = await call()

        expect(res.status).toBe(200)
        const { url, returnUrl } = await res.json()
        const start = new URL(url)
        expect(`${start.origin}${start.pathname}`).toBe('https://app.rerun.build/api/oauth/mobile/start')
        expect(verifyConnectTicket(start.searchParams.get('t'))).toMatchObject({ agentId: '', vaultItem: 'item-1', workspaceId: 7, userId: 'user-1', desktop: 'stable' })
        expect(returnUrl).toBe('rerun-desktop://oauth/callback')
    })

    it('hands one out for a Composio and a managed entry too', async () => {
        for (const target of [{ composio: { toolkit: 'gmail', serverName: 'gmail' } }, { managed: { provider: 'typeform', serverName: 'typeform' } }]) {
            vi.mocked(getVaultItem).mockResolvedValueOnce({ id: 'item-1', ...target } as never)
            const res = await call()
            expect(res.status).toBe(200)
            expect(verifyConnectTicket(new URL((await res.json()).url).searchParams.get('t'))).toMatchObject({ vaultItem: 'item-1' })
        }
    })

    it('refuses an entry with no sign-in', async () => {
        vi.mocked(getVaultItem).mockResolvedValue({ id: 'item-1' } as never)

        const res = await call()

        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ code: 'vaultEntryOtherServer' })
    })

    it('refuses a member who may not add to the Vault', async () => {
        vi.mocked(assertCanAdd).mockRejectedValue(new AccessDeniedError('vaultManageOnly'))

        const res = await call()

        expect(res.status).toBe(403)
        expect(getVaultItem).not.toHaveBeenCalled()
    })
})
