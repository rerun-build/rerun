import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-shell-env-'))
process.env.RERUN_API_KEY = 'engine-space-key'
process.env.RERUN_HUB_BASE_URL = 'https://hub.example'

const { describe, expect, it, vi } = await import('vitest')
const { HostBreaker } = await import('../host-breaker.js')
const { shellTools } = await import('./shell.js')
const { agentConfigSchema } = await import('../../agents/types.js')
const { agentDataDbPath, sharedDbPath, workspaceDir } = await import('../../config/paths.js')

type Runner = NonNullable<Parameters<typeof shellTools>[1]>
type Options = Parameters<Runner>[1]

async function optionsSeenBy(agentEnv: Record<string, string>, tools: Record<string, boolean> = {}): Promise<Options> {
    const run = vi.fn<Runner>(async () => ({ stdout: '', stderr: '' }))
    const ctx = { agent: { id: 'env-agent', env: agentEnv, config: agentConfigSchema.parse({ name: 'env', tools }) }, sessionId: 's', logger: { warn() {} }, hostBreaker: new HostBreaker() } as any
    await (shellTools(ctx, run).shell_exec as any).execute({ command: 'env', timeoutMs: 1000 }, { toolCallId: 'c', messages: [] })
    return run.mock.calls[0][1]
}

describe('shell_exec child environment', () => {
    it('runs in the workspace with the agent variables and the paths the prompt names', async () => {
        const options = await optionsSeenBy({ LINEAR_API_KEY: 'lin' })
        expect(options.cwd).toBe(workspaceDir('env-agent'))
        expect(options.env).toMatchObject({
            LINEAR_API_KEY: 'lin',
            RERUN_WORKSPACE: workspaceDir('env-agent'),
            RERUN_AGENT_DB: agentDataDbPath('env-agent'),
            RERUN_SHARED_DB: sharedDbPath(),
        })
        expect(options.timeout).toBe(1000)
    })

    it('leaves the shared database path out when the agent has no shared database', async () => {
        const options = await optionsSeenBy({}, { sharedDb: false })
        expect(options.env).not.toHaveProperty('RERUN_SHARED_DB')
    })

    it('does not let an agent variable move the workspace or the database paths', async () => {
        const options = await optionsSeenBy({ RERUN_WORKSPACE: '/', RERUN_AGENT_DB: '/tmp/other.db' })
        expect(options.env?.RERUN_WORKSPACE).toBe(workspaceDir('env-agent'))
        expect(options.env?.RERUN_AGENT_DB).toBe(agentDataDbPath('env-agent'))
    })

    it('lets an agent variable replace an engine variable such as PATH', async () => {
        expect((await optionsSeenBy({ PATH: '/agent/bin' })).env?.PATH).toBe('/agent/bin')
    })

    it('keeps the engine hub credentials and data dir out of every command', async () => {
        const options = await optionsSeenBy({})
        expect(options.env).not.toHaveProperty('RERUN_API_KEY')
        expect(options.env).not.toHaveProperty('RERUN_HUB_BASE_URL')
        expect(options.env).not.toHaveProperty('RERUN_DATA_DIR')
        expect(options.env?.RERUN_WORKSPACE).toBe(workspaceDir('env-agent'))
        expect(options.env?.PATH).toBe(process.env.PATH)
    })
})
