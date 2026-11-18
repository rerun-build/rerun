import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-mcp-prepare-'))
process.env.RERUN_API_KEY = ''

const steps = vi.hoisted(() => [] as string[])
const resolvedWith = vi.hoisted(() => [] as Record<string, string>[])

vi.mock('./mcp-auth.js', () => ({
    withAuth: async (agentId: string, server: { name: string; url?: string; headers: Record<string, string> }) => {
        steps.push(`auth:${agentId}:${server.url}`)
        return { ...server, headers: { ...server.headers, Authorization: 'Bearer oauth' } }
    },
}))
vi.mock('./mcp-resolve.js', () => ({
    resolveServerSecrets: (server: { url?: string; headers: Record<string, string> }, env: Record<string, string>) => {
        steps.push(`secrets:${server.headers.Authorization}:${Object.keys(env).join(',')}`)
        resolvedWith.push(env)
        return { ...server, url: server.url?.replace('${HOST}', env.HOST) }
    },
}))
vi.mock('./mcp-hub-headers.js', () => ({
    withHubHeaders: (server: { url?: string; headers: Record<string, string> }, agentId: string) => {
        steps.push(`hub:${server.url}:${agentId}`)
        return { ...server, headers: { ...server.headers, 'x-rerun-agent': agentId } }
    },
}))

const { afterEach, describe, expect, it } = await import('vitest')
const { rm } = await import('node:fs/promises')
const { prepareMcpServer } = await import('./mcp.js')
const { dataDir, workspaceDir } = await import('../config/paths.js')
const { writeSharedEnv } = await import('../agents/shared-env.js')

describe('prepareMcpServer', () => {
    afterEach(async () => {
        await rm(resolve(dataDir(), 'shared.env'), { force: true })
    })

    it('adds the OAuth bearer, then resolves the variables, then stamps the hub headers', async () => {
        const prepared = await prepareMcpServer('agent-1', { name: 'x', url: 'https://${HOST}/api/mcp/x', args: [], env: {}, headers: {} }, { HOST: 'hub.example' })
        expect(steps).toEqual(['auth:agent-1:https://${HOST}/api/mcp/x', 'secrets:Bearer oauth:HOST,RERUN_WORKSPACE', 'hub:https://hub.example/api/mcp/x:agent-1'])
        expect(prepared).toMatchObject({ url: 'https://hub.example/api/mcp/x', headers: { Authorization: 'Bearer oauth', 'x-rerun-agent': 'agent-1' } })
    })

    it('stamps the hub headers with the coworker a delegate acts for, keeping its own auth and workspace', async () => {
        steps.length = 0
        await prepareMcpServer('delegate-1', { name: 'gmail', url: 'https://hub.example/api/mcp/composio/gmail', args: [], env: {}, headers: {} }, {}, 'boss')
        expect(steps[0]).toBe('auth:delegate-1:https://hub.example/api/mcp/composio/gmail')
        expect(steps.at(-1)).toBe('hub:https://hub.example/api/mcp/composio/gmail:boss')
        expect(resolvedWith.at(-1)?.RERUN_WORKSPACE).toBe(workspaceDir('delegate-1'))
    })

    it("resolves ${RERUN_WORKSPACE} to the agent's own workspace, whatever its env says", async () => {
        await prepareMcpServer('agent-2', { name: 'mail', command: 'npx', args: [], env: { MAIL_ALLOWED_ROOTS: '${RERUN_WORKSPACE}' }, headers: {} }, { RERUN_WORKSPACE: '/' })
        expect(resolvedWith.at(-1)?.RERUN_WORKSPACE).toBe(workspaceDir('agent-2'))
    })

    it('resolves a shared variable the coworker env does not hold, under the coworker value', async () => {
        await writeSharedEnv({ EVEROS_TOKEN: 'ev-shared-123456', HOST: 'shared.example' })
        await prepareMcpServer('agent-3', { name: 'x', url: 'https://${HOST}/api/mcp/x', args: [], env: {}, headers: {} }, { HOST: 'own.example' })
        expect(resolvedWith.at(-1)).toEqual({ EVEROS_TOKEN: 'ev-shared-123456', HOST: 'own.example', RERUN_WORKSPACE: workspaceDir('agent-3') })
    })
})
