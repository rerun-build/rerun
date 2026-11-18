import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-process-env-'))

const { afterEach, describe, expect, it } = await import('vitest')
const { rm } = await import('node:fs/promises')
const { agentConfigSchema } = await import('@rerun/contracts')
const { agentProcessEnv } = await import('./process-env.js')
const { agentDataDbPath, dataDir, sharedDbPath, workspaceDir } = await import('../config/paths.js')
const { writeSharedEnv } = await import('./shared-env.js')

function agent(tools: Record<string, boolean>, env: Record<string, string> = {}) {
    return { id: 'env-agent', env, config: agentConfigSchema.parse({ name: 'Env test', tools }) }
}

describe('agentProcessEnv', () => {
    afterEach(async () => {
        await rm(resolve(dataDir(), 'shared.env'), { force: true })
    })

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

    it('leaves process.env out, so each caller decides what the process inherits', () => {
        expect(agentProcessEnv(agent({ sharedDb: false })).env.PATH).toBeUndefined()
    })

    it('merges labels after the agent .env', () => {
        const { env } = agentProcessEnv(agent({ sharedDb: false }, { A: '1' }), { RERUN_JOB: 'rerun#1', A: 'label' })
        expect(env.RERUN_JOB).toBe('rerun#1')
        expect(env.A).toBe('label')
    })

    it('does not let a label move the workspace or the private database', () => {
        const { env } = agentProcessEnv(agent({ sharedDb: false }), { RERUN_WORKSPACE: '/x', RERUN_AGENT_DB: '/y' })
        expect(env.RERUN_WORKSPACE).toBe(workspaceDir('env-agent'))
        expect(env.RERUN_AGENT_DB).toBe(agentDataDbPath('env-agent'))
    })

    it('gives the old result when labels are omitted', () => {
        expect(agentProcessEnv(agent({ sharedDb: true }), undefined)).toEqual(agentProcessEnv(agent({ sharedDb: true })))
        expect(agentProcessEnv(agent({ sharedDb: true }), {})).toEqual(agentProcessEnv(agent({ sharedDb: true })))
    })

    it('fills a missing name from the shared variables and lets the coworker value win', async () => {
        await writeSharedEnv({ GH_TOKEN: 'tok-shared-12345', EVEROS_URL: 'https://everos.example', RERUN_WORKSPACE: '/shared' })
        const { env } = agentProcessEnv(agent({ sharedDb: false }, { GH_TOKEN: 'own-token-123456' }))
        expect(env.GH_TOKEN).toBe('own-token-123456')
        expect(env.EVEROS_URL).toBe('https://everos.example')
        expect(env.RERUN_WORKSPACE).toBe(workspaceDir('env-agent'))
    })
})
