import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-datadir-ladder-'))
process.env.RERUN_DATA_DIR = dataDir

const { beforeEach, describe, expect, it } = await import('vitest')
const { chmod, mkdir, readFile, readdir, rm, stat, symlink, writeFile } = await import('node:fs/promises')
const { existsSync } = await import('node:fs')
const { RERUN_CONNECTION_ID } = await import('@rerun/contracts')
const { agentEnvPath, agentDir, agentsDir, boxPlanPath, configPath, connectionsDir, connectionsMigratedPath, dataVersionPath, mcpDir, mcpPackagesDir, mcpPendingPath, mcpTokenPath, vaultDir } = await import('../config/paths.js')
const { writeEnvFile, readEnvFile } = await import('../lib/env-file.js')
const { raw } = await import('../db/client.js')
const { buildCommit } = await import('../runtime/build-info.js')
const { listConnections, unloadConnection } = await import('../connections/registry.js')
const { DATA_DIR_MIGRATIONS, DATA_DIR_VERSION } = await import('./migrations.js')
const { migrateDataDir, prepareDataDir } = await import('./ladder.js')
const { readDataVersion, writeDataVersion } = await import('./version.js')

type Step = (typeof DATA_DIR_MIGRATIONS)[number]

function recorder(log: number[], fail?: number): Step[] {
    return [1, 2].map(version => ({
        version,
        id: `step-${version}`,
        up: async () => {
            if (version === fail) throw new Error(`step ${version} failed`)
            log.push(version)
        },
    }))
}

beforeEach(async () => {
    unloadConnection(RERUN_CONNECTION_ID)
    await rm(dataVersionPath(), { force: true })
    await rm(connectionsDir(), { recursive: true, force: true })
    await rm(agentsDir(), { recursive: true, force: true })
})

describe('migrateDataDir', () => {
    it('applies the steps a data-dir has not seen and records each one', async () => {
        const log: number[] = []
        await migrateDataDir(recorder(log))
        expect(log).toEqual([1, 2])
        const file = JSON.parse(await readFile(dataVersionPath(), 'utf8'))
        expect(file).toMatchObject({ version: 2, commit: buildCommit() })
    })

    it('does nothing on a data-dir already at the last step', async () => {
        await writeDataVersion(2)
        const log: number[] = []
        await migrateDataDir(recorder(log))
        expect(log).toEqual([])
    })

    it('stops at the last step that succeeded, and finishes on the next boot', async () => {
        const log: number[] = []
        await expect(migrateDataDir(recorder(log, 2))).rejects.toThrow('step 2 failed')
        expect(readDataVersion()).toBe(1)

        await migrateDataDir(recorder(log))
        expect(log).toEqual([1, 2])
        expect(readDataVersion()).toBe(2)
    })

    it('leaves a data-dir migrated by a newer engine as it is', async () => {
        await writeDataVersion(7)
        const log: number[] = []
        await migrateDataDir(recorder(log))
        expect(log).toEqual([])
        expect(readDataVersion()).toBe(7)
    })

    it('reads an unreadable version file as v0', async () => {
        await writeFile(dataVersionPath(), 'not json', 'utf8')
        expect(readDataVersion()).toBe(0)
    })
})

describe('a data-dir from before the ladder', () => {
    it('catches up to the current version', async () => {
        await mkdir(agentDir('alpha'), { recursive: true })
        await writeFile(configPath('alpha'), JSON.stringify({ name: 'alpha', provider: 'anthropic' }), 'utf8')
        await writeEnvFile(agentEnvPath('alpha'), { ANTHROPIC_API_KEY: 'k', MY_VAR: 'kept' })
        await raw().execute('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY)')

        await prepareDataDir()

        expect(readDataVersion()).toBe(DATA_DIR_VERSION)
        expect(existsSync(connectionsMigratedPath())).toBe(true)
        expect(await readEnvFile(agentEnvPath('alpha'))).toEqual({ MY_VAR: 'kept' })
        const tables = (await raw().execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map(r => String(r.name))
        expect(tables).toContain('agents')
        expect(tables).not.toContain('runs')
        expect((await listConnections()).map(c => c.config.provider).sort()).toEqual(['anthropic', 'rerun'])
    })

    it('recreates the agents index on a migrated data-dir that lost it, without replaying the ladder', async () => {
        await writeDataVersion(DATA_DIR_VERSION)
        await raw().execute('DROP TABLE IF EXISTS agents')

        await prepareDataDir()

        const tables = (await raw().execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map(r => String(r.name))
        expect(tables).toContain('agents')
        expect(readDataVersion()).toBe(DATA_DIR_VERSION)
        expect(existsSync(connectionsMigratedPath())).toBe(false)
    })

    // Every box running today folded its keys long before the ladder: its marker must keep the
    // baseline step from folding a second time.
    it('takes a box that already folded its keys to v1 without touching them', async () => {
        await mkdir(connectionsDir(), { recursive: true })
        await writeFile(connectionsMigratedPath(), '2026-01-01T00:00:00.000Z\n', 'utf8')
        await mkdir(agentDir('alpha'), { recursive: true })
        await writeFile(configPath('alpha'), JSON.stringify({ name: 'alpha', provider: 'anthropic' }), 'utf8')
        await writeEnvFile(agentEnvPath('alpha'), { ANTHROPIC_API_KEY: 'k' })

        await prepareDataDir()

        expect(readDataVersion()).toBe(DATA_DIR_VERSION)
        expect(await readEnvFile(agentEnvPath('alpha'))).toEqual({ ANTHROPIC_API_KEY: 'k' })
    })
})

describe('v1 to v2: box-plan', () => {
    const boxPlan = DATA_DIR_MIGRATIONS.find(s => s.id === 'box-plan')!

    it('writes an unrestricted plan on a box the hub never told', async () => {
        await rm(boxPlanPath(), { force: true })
        await writeDataVersion(1)
        await migrateDataDir()
        expect(readDataVersion()).toBe(DATA_DIR_VERSION)
        expect(JSON.parse(await readFile(boxPlanPath(), 'utf8'))).toEqual({ premiumModels: true })
    })

    it('keeps the plan the hub already pushed, and replays without harm', async () => {
        await writeFile(boxPlanPath(), JSON.stringify({ premiumModels: false }), 'utf8')
        await boxPlan.up()
        await boxPlan.up()
        expect(JSON.parse(await readFile(boxPlanPath(), 'utf8'))).toEqual({ premiumModels: false })
    })
})

describe('v2 to v3: mcp-packages', () => {
    const mcpPackages = DATA_DIR_MIGRATIONS.find(s => s.id === 'mcp-packages')!

    it('creates the folder the npx packages are installed in', async () => {
        await rm(mcpPackagesDir(), { recursive: true, force: true })
        await writeDataVersion(2)
        await migrateDataDir()
        expect(readDataVersion()).toBe(DATA_DIR_VERSION)
        expect(existsSync(mcpPackagesDir())).toBe(true)
    })

    it('keeps what is already installed, and replays without harm', async () => {
        await mkdir(resolve(mcpPackagesDir(), 'abc'), { recursive: true })
        await writeFile(resolve(mcpPackagesDir(), 'abc', 'current.json'), '{}', 'utf8')
        await mcpPackages.up()
        await mcpPackages.up()
        expect(await readFile(resolve(mcpPackagesDir(), 'abc', 'current.json'), 'utf8')).toBe('{}')
    })
})

describe('v3 to v4: secret-file-modes', () => {
    const secretModes = DATA_DIR_MIGRATIONS.find(s => s.id === 'secret-file-modes')!
    const mode = async (path: string) => (await stat(path)).mode & 0o777

    async function writeWithMode(path: string, fileMode: number) {
        await writeFile(path, '{}', 'utf8')
        await chmod(path, fileMode)
    }

    // What an engine from before this step left behind: everything at the default modes.
    async function legacyAgent(id: string) {
        await mkdir(mcpDir(id), { recursive: true })
        await chmod(mcpDir(id), 0o755)
        await writeWithMode(configPath(id), 0o644)
        await writeWithMode(mcpTokenPath(id, 'srv'), 0o644)
        await writeWithMode(mcpPendingPath(id, 'srv'), 0o644)
    }

    it('closes config.json and the mcp folder to other users, from v3', async () => {
        await legacyAgent('alpha')
        await writeDataVersion(3)
        await migrateDataDir()
        expect(readDataVersion()).toBe(DATA_DIR_VERSION)
        expect(await mode(configPath('alpha'))).toBe(0o600)
        expect(await mode(mcpDir('alpha'))).toBe(0o700)
        expect(await mode(mcpTokenPath('alpha', 'srv'))).toBe(0o600)
        expect(await mode(mcpPendingPath('alpha', 'srv'))).toBe(0o600)
    })

    it('replays without harm', async () => {
        await legacyAgent('beta')
        await secretModes.up()
        await secretModes.up()
        expect(await mode(configPath('beta'))).toBe(0o600)
        expect(await mode(mcpDir('beta'))).toBe(0o700)
        expect(await mode(mcpTokenPath('beta', 'srv'))).toBe(0o600)
    })

    it('does nothing on a data-dir without agents', async () => {
        await expect(secretModes.up()).resolves.toBeUndefined()
        expect(existsSync(agentsDir())).toBe(false)
    })

    it('leaves an agent without an mcp folder as it is, and skips what is not an agent folder', async () => {
        await mkdir(agentDir('gamma'), { recursive: true })
        await writeWithMode(configPath('gamma'), 0o644)
        await writeWithMode(resolve(agentsDir(), 'stray.json'), 0o644)
        await secretModes.up()
        expect(await mode(configPath('gamma'))).toBe(0o600)
        expect(existsSync(mcpDir('gamma'))).toBe(false)
        expect(await mode(resolve(agentsDir(), 'stray.json'))).toBe(0o644)
    })

    it('touches only the json files of mcp/, never what a link points to', async () => {
        await legacyAgent('delta')
        await writeWithMode(resolve(mcpDir('delta'), 'notes.txt'), 0o644)
        const elsewhere = resolve(dataDir, 'elsewhere.json')
        await writeWithMode(elsewhere, 0o644)
        await symlink(elsewhere, mcpTokenPath('delta', 'linked'))
        await secretModes.up()
        expect(await mode(mcpTokenPath('delta', 'srv'))).toBe(0o600)
        expect(await mode(resolve(mcpDir('delta'), 'notes.txt'))).toBe(0o644)
        expect(await mode(elsewhere)).toBe(0o644)
    })
})

describe('v4 to v5: vault', () => {
    const vaultStep = DATA_DIR_MIGRATIONS.find(s => s.id === 'vault')!
    const mode = async (path: string) => (await stat(path)).mode & 0o777

    beforeEach(async () => {
        await rm(vaultDir(), { recursive: true, force: true })
    })

    it('creates an empty Vault closed to other users, from v4', async () => {
        await mkdir(agentDir('alpha'), { recursive: true })
        await writeFile(configPath('alpha'), '{}', 'utf8')
        await writeDataVersion(4)
        await migrateDataDir()
        expect(readDataVersion()).toBe(5)
        expect(await readdir(vaultDir())).toEqual([])
        expect(await mode(vaultDir())).toBe(0o700)
        expect(await readFile(configPath('alpha'), 'utf8')).toBe('{}')
    })

    it('keeps what a Vault already holds, closes a folder left open, and replays without harm', async () => {
        await mkdir(resolve(vaultDir(), 'item1'), { recursive: true })
        await chmod(vaultDir(), 0o755)
        await writeFile(resolve(vaultDir(), 'item1', 'item.json'), '{"kind":"secret"}', 'utf8')
        await vaultStep.up()
        await vaultStep.up()
        expect(await readFile(resolve(vaultDir(), 'item1', 'item.json'), 'utf8')).toBe('{"kind":"secret"}')
        expect(await mode(vaultDir())).toBe(0o700)
    })
})

// Append-only: a shipped step is never removed nor renamed, because a data-dir archived before it
// still needs it. Updating this snapshot is the change to look at twice.
describe('data-dir ladder', () => {
    it('numbers its steps from 1 without gaps', () => {
        expect(DATA_DIR_MIGRATIONS.map(s => s.version)).toEqual(DATA_DIR_MIGRATIONS.map((_, i) => i + 1))
        expect(new Set(DATA_DIR_MIGRATIONS.map(s => s.id)).size).toBe(DATA_DIR_MIGRATIONS.length)
    })

    it('keeps every shipped step', () => {
        expect(DATA_DIR_MIGRATIONS.map(s => [s.version, s.id])).toMatchInlineSnapshot(`
          [
            [
              1,
              "baseline",
            ],
            [
              2,
              "box-plan",
            ],
            [
              3,
              "mcp-packages",
            ],
            [
              4,
              "secret-file-modes",
            ],
            [
              5,
              "vault",
            ],
          ]
        `)
    })
})
