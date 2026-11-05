import { resolveAgentTarget } from '@/app/api/_services/chat.service'
import { putMcpToken } from '@/lib/engine/client'
import type { ParkedSignIn } from '@/lib/oauth/pending-grant'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finishParkedSignIn } from './oauth-claim.service'

vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn() }))
vi.mock('@/app/api/_services/services.service', () => ({ markComposioAuthorized: vi.fn(), markManagedAuthorized: vi.fn(), markServiceAuthorized: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ putMcpToken: vi.fn() }))
vi.mock('@/lib/managed/registry', () => ({ getManagedProvider: vi.fn() }))
vi.mock('@/lib/oauth/pending-grant', () => ({ claimSignIn: vi.fn(), SignInClaimError: class SignInClaimError extends Error {} }))

const CONN = { baseUrl: 'https://engine.test', apiKey: null }
const TOKEN = { accessToken: 'at', refreshToken: 'rt', tokenEndpoint: 'https://auth.test/token', obtainedAt: 1 }

function parkedMcp(patch: Partial<Extract<ParkedSignIn, { kind: 'mcp' }>> = {}): ParkedSignIn {
    return { kind: 'mcp', serverName: 'asana', mcpUrl: 'https://mcp.asana.com/v2/mcp', token: { ...TOKEN, clientId: 'asana-id' }, ...patch }
}

describe('finishParkedSignIn', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(resolveAgentTarget).mockResolvedValue({ conn: CONN, engineAgentId: 'engine-agent' } as never)
        vi.stubEnv('RERUN_ASANA_MCP_CLIENT_ID', 'asana-id')
        vi.stubEnv('RERUN_ASANA_MCP_CLIENT_SECRET', 'asana-secret')
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_ID', 'gh-id')
        vi.stubEnv('RERUN_GITHUB_MCP_CLIENT_SECRET', 'gh-secret')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('reads the Asana secret from the environment at the claim, the parked bundle never held it', async () => {
        await finishParkedSignIn('agent-1', 7, parkedMcp())

        expect(resolveAgentTarget).toHaveBeenCalledWith('agent-1', 7)
        expect(putMcpToken).toHaveBeenCalledWith(CONN, 'engine-agent', 'asana', { ...TOKEN, clientId: 'asana-id', clientSecret: 'asana-secret' })
    })

    it('keeps the GitHub secret on the hub', async () => {
        await finishParkedSignIn('agent-1', 7, parkedMcp({ serverName: 'github', mcpUrl: 'https://api.githubcopilot.com/mcp/', token: { ...TOKEN, clientId: 'gh-id' } }))

        expect(putMcpToken).toHaveBeenCalledWith(CONN, 'engine-agent', 'github', { ...TOKEN, clientId: 'gh-id', clientSecret: undefined })
    })

    it('writes a bundle parked by a hub that named no MCP server as it is', async () => {
        await finishParkedSignIn('agent-1', 7, parkedMcp({ mcpUrl: undefined, token: { ...TOKEN, clientId: 'dcr-id', clientSecret: 'dcr-secret' } }))

        expect(putMcpToken).toHaveBeenCalledWith(CONN, 'engine-agent', 'asana', { ...TOKEN, clientId: 'dcr-id', clientSecret: 'dcr-secret' })
    })
})
