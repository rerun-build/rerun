import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticateEngineToken } from '@/app/api/_services/workspace-engine.service'
import { supportsForemanVault } from '@/lib/engine/client'
import { founderContext } from '@/lib/foreman/checkin-context'
import { verifyForemanHubToken } from '@/lib/foreman/hub-token'
import { loadForemanState } from '@/lib/foreman/state'

vi.mock('server-only', () => ({}))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ authenticateEngineToken: vi.fn(), getWorkspaceConnection: vi.fn().mockResolvedValue({ baseUrl: 'https://box.test' }) }))
vi.mock('@/lib/engine/client', () => ({ supportsForemanVault: vi.fn() }))
vi.mock('@/lib/foreman/checkin-context', () => ({ founderContext: vi.fn() }))
vi.mock('@/lib/foreman/state', () => ({ loadForemanState: vi.fn() }))

const { POST } = await import('./route')

const WORKSPACE_ID = 7

const request = (body: unknown, token: string | null = 'engine-key') => new Request('https://rerun.test/api/foreman/checkin-brief', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })

const state = { foreman: {}, answers: {}, workspaceName: 'Acme', workspacePlan: 'base', language: 'French', spaces: [], agents: [], hiddenBoxes: 0, firstName: 'Ada' }

describe('POST /api/foreman/checkin-brief', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubEnv('FOREMAN_HUB_TOKEN_SECRET', 'test-secret')
        vi.mocked(authenticateEngineToken).mockImplementation(async token => (token === 'engine-key' ? { workspaceId: WORKSPACE_ID, isSandbox: false } : null))
        vi.mocked(founderContext).mockResolvedValue({ workspace: { id: WORKSPACE_ID } } as never)
        vi.mocked(loadForemanState).mockResolvedValue(state as never)
        vi.mocked(supportsForemanVault).mockResolvedValue(false)
    })

    afterEach(() => vi.unstubAllEnvs())

    it('refuses a caller without the key of a box', async () => {
        expect((await POST(request({ reason: 'pulse' }, null))).status).toBe(401)
        expect((await POST(request({ reason: 'pulse' }, 'stolen'))).status).toBe(401)
    })

    it('refuses a reason it does not know', async () => {
        expect((await POST(request({ reason: 'whenever' }))).status).toBe(400)
    })

    it('hands the charter of a check-in, only the hub tools that read, and a token that only reads', async () => {
        const res = await POST(request({ reason: 'pulse' }))
        expect(res.status).toBe(200)
        const brief = (await res.json()) as { instructions: string; tools: { name: string; kind: string }[]; hubToken: string }
        expect(brief.instructions).toContain('This run is a check-in')
        expect(brief.instructions).toContain('Its owner reads Rerun in French')
        expect(brief.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['list_agents', 'get_team_status', 'list_runs', 'search_docs']))
        for (const name of ['create_agent', 'delete_agent', 'send_message', 'run_schedule_now', 'set_name', 'focus_agent', 'install_template']) expect(brief.tools.map(tool => tool.name)).not.toContain(name)
        expect(brief.tools.every(tool => tool.kind === 'hub')).toBe(true)
        expect(verifyForemanHubToken(brief.hubToken, WORKSPACE_ID)).toMatchObject({ ws: WORKSPACE_ID, scope: 'read' })
    })

    it('reads the Vault only on a box whose Chief of Staff manages it', async () => {
        const names = async () => ((await (await POST(request({ reason: 'pulse' }))).json()) as { tools: { name: string }[] }).tools.map(tool => tool.name)
        expect(await names()).not.toContain('list_vault')
        vi.mocked(supportsForemanVault).mockResolvedValue(true)
        const withVault = await names()
        expect(withVault).toContain('list_vault')
        for (const name of ['attach_vault_entry', 'detach_vault_entry', 'share_vault_entry', 'delete_vault_entry']) expect(withVault).not.toContain(name)
    })

    it('says so when the workspace has nobody to read it for', async () => {
        vi.mocked(founderContext).mockResolvedValue(null)
        expect((await POST(request({ reason: 'manual' }))).status).toBe(404)
    })
})
