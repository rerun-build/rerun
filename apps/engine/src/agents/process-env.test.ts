import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-process-env-'))

const { describe, expect, it } = await import('vitest')
const { agentConfigSchema } = await import('@rerun/contracts')
const { agentProcessEnv } = await import('./process-env.js')
const { agentDataDbPath, sharedDbPath, workspaceDir } = await import('../config/paths.js')

function agent(tools: Record<string, boolean>, env: Record<string, string> = {}) {
    return { id: 'env-agent', env, config: agentConfigSchema.parse({ name: 'Env test', tools }) }
}

describe('agentProcessEnv', () => {
    it('names the workspace and the private database, and creates them', () => {
        const { cwd, env } = agentProcessEnv(agent({ sharedDb: false }))
        expect(cwd).toBe(workspaceDir('env-agent'))
        expect(env.RERUN_WORKSPACE).toBe(cwd)
        expect(env.RERUN_AGENT_DB).toBe(agentDataDbPath('env-agent'))
        expect(existsSync(cwd)).toBe(true)
    })

    it('names the shared database only when the agent can reach it', () => {
        expect(agentProcessEnv(agent({ sharedDb: false })).env.RERUN_SHARED_DB).toBeUndefined()
        expect(agentProcessEnv(agent({ sharedDb: true })).env.RERUN_SHARED_DB).toBe(sharedDbPath())
    })

    it('carries the agent .env underneath the Rerun paths, which it cannot override', () => {
        const { env } = agentProcessEnv(agent({ sharedDb: false }, { API_TOKEN: 'x', RERUN_WORKSPACE: '/elsewhere' }))
        expect(env.API_TOKEN).toBe('x')
        expect(env.RERUN_WORKSPACE).toBe(workspaceDir('env-agent'))
    })

    // RER-178: Debian's Python refused every `pip install`, so the coworker could not add Pillow.
    it('lets pip install past an externally managed Python, unless the agent .env says otherwise', () => {
        expect(agentProcessEnv(agent({ sharedDb: false })).env.PIP_BREAK_SYSTEM_PACKAGES).toBe('1')
        expect(agentProcessEnv(agent({ sharedDb: false }, { PIP_BREAK_SYSTEM_PACKAGES: '0' })).env.PIP_BREAK_SYSTEM_PACKAGES).toBe('0')
    })

    it('leaves process.env out, so each caller decides what the process inherits', () => {
        expect(agentProcessEnv(agent({ sharedDb: false })).env.PATH).toBeUndefined()
    })
})
