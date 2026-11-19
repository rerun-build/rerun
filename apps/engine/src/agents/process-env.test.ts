import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-process-env-'))

const { afterEach, describe, expect, it } = await import('vitest')
const { rm } = await import('node:fs/promises')
const { agentConfigSchema } = await import('@moldwright/contracts')
const { agentProcessEnv } = await import('./process-env.js')
const { agentDataDbPath, dataDir, sharedDbPath, workspaceDir } = await import('../config/paths.js')
const { writeSharedEnv } = await import('./shared-env.js')
const { childProcessEnv } = await import('../lib/child-env.js')
const { execFileSync } = await import('node:child_process')
const { mkdtempSync: mkTemp } = await import('node:fs')

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

    it('git answers github.com credentials from the shared GH_TOKEN', async () => {
        await writeSharedEnv({ GH_TOKEN: 'tok-git-123456' })
        const base = agentProcessEnv(agent({ sharedDb: false }))
        const env = childProcessEnv(base.env, { HOME: mkdtempSync(resolve(tmpdir(), 'rerun-git-home-')), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' })
        const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', env, encoding: 'utf8' })
        expect(out).toContain('username=x-access-token')
        expect(out).toContain('password=tok-git-123456')
        const carriers = Object.values(base.env).filter(value => value.includes('tok-git-123456'))
        expect(carriers).toHaveLength(1)
    })

    it('adds no git credential entries without a GH_TOKEN', () => {
        const { env } = agentProcessEnv(agent({ sharedDb: false }))
        expect(env.GIT_CONFIG_COUNT).toBeUndefined()
        expect(env.GIT_CONFIG_KEY_1).toBeUndefined()
    })

    it("leaves a coworker's own git config entries untouched", async () => {
        await writeSharedEnv({ GH_TOKEN: 'tok-shared-12345' })
        const { env } = agentProcessEnv(agent({ sharedDb: false }, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'own' }))
        expect(env.GIT_CONFIG_COUNT).toBe('1')
        expect(env.GIT_CONFIG_KEY_0).toBe('user.name')
        expect(env.GIT_CONFIG_VALUE_0).toBe('own')
        expect(env.GIT_CONFIG_KEY_1).toBeUndefined()
    })
})
