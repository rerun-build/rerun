import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cx-boot-refresh-'))
process.env.RERUN_API_KEY = ''

const { afterEach, describe, expect, it, vi } = await import('vitest')

const slowRead = { next: false }
vi.mock('./loader.js', async importOriginal => {
    const actual = await importOriginal<typeof import('./loader.js')>()
    return {
        ...actual,
        loadConnectionFromDisk: async (id: string) => {
            const delayed = slowRead.next
            slowRead.next = false
            const connection = await actual.loadConnectionFromDisk(id)
            if (delayed) await new Promise(r => setTimeout(r, 30))
            return connection
        },
    }
})

const { mkdir, writeFile } = await import('node:fs/promises')
const { connectionConfigPath, connectionDir, connectionEnvPath } = await import('../config/paths.js')
const { getConnection, listConnections } = await import('./registry.js')
const { ensureFreshClaudeToken } = await import('./claude-token.js')

const ID = 'claude-plan'

afterEach(() => {
    vi.unstubAllGlobals()
})

// RER-413: an engine restarted with a Claude token under four hours from its end refreshed it from
// the boot's list, while the scheduler had read the same connection a moment later. Every run that
// followed sent the refresh token Anthropic had just spent, and was turned away as signed out.
describe('a Claude refresh at boot', () => {
    it('reaches the connection every later run reads', async () => {
        await mkdir(connectionDir(ID), { recursive: true })
        await writeFile(connectionConfigPath(ID), JSON.stringify({ name: 'Claude', provider: 'claude', models: ['claude-opus-5-5'], createdAt: '2026-01-01T00:00:00.000Z' }))
        await writeFile(connectionEnvPath(ID), `CLAUDE_CODE_OAUTH_TOKEN=old-access\nCLAUDE_CODE_OAUTH_REFRESH_TOKEN=old-refresh\nCLAUDE_CODE_OAUTH_EXPIRES_AT=${Date.now() + 2 * 3_600_000}\n`)
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 28_800 }), { status: 200 })))

        const bootList = listConnections().then(connections => connections.find(c => c.id === ID)!)
        slowRead.next = true
        const schedulerRead = getConnection(ID)
        await ensureFreshClaudeToken(await bootList)
        await schedulerRead

        const later = await getConnection(ID)
        expect(later.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBe('new-refresh')
        expect(later.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('new-access')
    })
})
