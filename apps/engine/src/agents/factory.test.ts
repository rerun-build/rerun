import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-factory-'))
process.env.RERUN_API_KEY = ''

const { beforeAll, describe, expect, it } = await import('vitest')
const { existsSync } = await import('node:fs')
const { readFile, stat } = await import('node:fs/promises')
const { RERUN_MODEL } = await import('@moldwright/contracts')
const { migrate } = await import('../db/migrate.js')
const { getAgentIndex } = await import('../db/repos/agents.js')
const { agentDir, agentEnvPath, configPath, installPath, skillsDir, soulPath, workspaceDir } = await import('../config/paths.js')
const { createAgent } = await import('./factory.js')
const { defaultSoul } = await import('./soul.js')
const { listAgentIdsOnDisk, loadAgentFromDisk } = await import('./loader.js')

beforeAll(async () => {
    await migrate()
})

describe('createAgent', () => {
    it('lays out a fresh agent folder with a default soul and indexes it', async () => {
        const agent = await createAgent({ config: { name: 'Scout', description: 'Finds leads' } })

        expect(agent.id).toMatch(/^[0-9a-z]{21}$/)
        for (const dir of [workspaceDir(agent.id), skillsDir(agent.id), resolve(agentDir(agent.id), 'memory')]) expect(existsSync(dir), dir).toBe(true)
        expect(JSON.parse(await readFile(configPath(agent.id), 'utf8'))).toEqual(agent.config)
        expect(agent.soul).toBe(defaultSoul(agent.config))
        expect(await readFile(soulPath(agent.id), 'utf8')).toBe(agent.soul)
        expect(existsSync(installPath(agent.id))).toBe(false)
        expect(agent.install).toBe('')
        expect(agent.env).toEqual({})
        expect(agent.resolved).toEqual({ connection: null, provider: 'rerun', model: RERUN_MODEL })
        expect(await getAgentIndex(agent.id)).toMatchObject({ id: agent.id, name: 'Scout', status: 'idle' })
    })

    it('always writes a user agent, whatever kind it was handed', async () => {
        const agent = await createAgent({ config: { name: 'Sneaky', kind: 'foreman' } })
        expect(agent.config.kind).toBe('user')
        expect(JSON.parse(await readFile(configPath(agent.id), 'utf8')).kind).toBe('user')
    })

    it('keeps a soul it is given as is', async () => {
        const agent = await createAgent({ config: { name: 'Custom' }, soul: '# Custom\n\nBe brief.' })
        expect(await readFile(soulPath(agent.id), 'utf8')).toBe('# Custom\n\nBe brief.')
    })

    it('writes INSTALL.md only when the instructions are not blank', async () => {
        const blank = await createAgent({ config: { name: 'Blank' }, install: '  \n\t ' })
        expect(existsSync(installPath(blank.id))).toBe(false)
        expect(blank.install).toBe('')

        const guided = await createAgent({ config: { name: 'Guided' }, install: '\n  Connect Gmail, then send a test.  \n' })
        expect(await readFile(installPath(guided.id), 'utf8')).toBe('Connect Gmail, then send a test.\n')
        expect(guided.install).toBe('Connect Gmail, then send a test.')
    })

    it('stores the keys in an owner-only .env', async () => {
        const agent = await createAgent({ config: { name: 'Keyed' }, keys: { FAL_KEY: 'fal-secret', OTHER: 'x' } })
        expect(agent.env).toEqual({ FAL_KEY: 'fal-secret', OTHER: 'x' })
        expect((await stat(agentEnvPath(agent.id))).mode & 0o777).toBe(0o600)
        expect((await loadAgentFromDisk(agent.id)).env).toEqual({ FAL_KEY: 'fal-secret', OTHER: 'x' })
    })

    it('refuses a key value holding a line break before writing anything', async () => {
        const before = await listAgentIdsOnDisk()
        await expect(createAgent({ config: { name: 'Broken' }, keys: { A: 'one\ntwo' } })).rejects.toMatchObject({ status: 400 })
        expect(await listAgentIdsOnDisk()).toEqual(before)
    })
})
