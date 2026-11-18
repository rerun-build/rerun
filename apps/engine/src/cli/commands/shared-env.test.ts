import { mkdtempSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-shared-env-'))
process.env.RERUN_API_KEY = ''

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { mkdir, rm } = await import('node:fs/promises')
const { agentConfigSchema } = await import('../../agents/types.js')
const { writeAgentConfig } = await import('../../agents/config-write.js')
const { writeAgentEnv } = await import('../../agents/env.js')
const { agentProcessEnv } = await import('../../agents/process-env.js')
const { agentDir, dataDir } = await import('../../config/paths.js')
const { sharedEnvCommand } = await import('./shared-env.js')

const VALUE = 'tok-shared-12345'
const sharedFile = () => resolve(dataDir(), 'shared.env')
let out = ''

function agent(id: string) {
    return { id, env: {}, config: agentConfigSchema.parse({ name: id, tools: { sharedDb: false } }) }
}

beforeEach(() => {
    out = ''
    vi.spyOn(process.stdout, 'write').mockImplementation(((s: string) => {
        out += s
        return true
    }) as never)
})

afterEach(async () => {
    vi.restoreAllMocks()
    process.exitCode = undefined
    await rm(sharedFile(), { force: true })
    await rm(resolve(dataDir(), 'agents'), { recursive: true, force: true })
})

describe('rerun shared-env', () => {
    it('a value set once reaches every coworker process and list shows only its name', async () => {
        await sharedEnvCommand(['set', 'GH_TOKEN'], async () => VALUE)
        expect(out).toBe('Set GH_TOKEN for every coworker.\n')
        expect(agentProcessEnv(agent('a1')).env.GH_TOKEN).toBe(VALUE)
        expect(agentProcessEnv(agent('a2')).env.GH_TOKEN).toBe(VALUE)
        out = ''
        await sharedEnvCommand(['list'])
        expect(out).toBe('GH_TOKEN\n')
        expect(out).not.toContain(VALUE)
        expect(statSync(sharedFile()).mode & 0o777).toBe(0o600)
    })

    it('lists names sorted and names the coworkers whose own value shadows one', async () => {
        await sharedEnvCommand(['set', 'ZED_URL'], async () => 'https://zed.example')
        await sharedEnvCommand(['set', 'GH_TOKEN'], async () => VALUE)
        for (const id of ['b2', 'b1']) {
            await mkdir(agentDir(id), { recursive: true })
            await writeAgentConfig(id, agentConfigSchema.parse({ name: id }))
            await writeAgentEnv(id, { GH_TOKEN: 'own-token-123456' })
        }
        out = ''
        await sharedEnvCommand(['list'])
        expect(out).toBe('GH_TOKEN (own value in: b1, b2)\nZED_URL\n')
    })

    it('says so when nothing is shared', async () => {
        await sharedEnvCommand(['list'])
        expect(out).toBe('No shared variables.\n')
    })

    it('refuses a bad name, a missing name or an extra argument and writes nothing', async () => {
        const bad: string[][] = [['set'], ['set', 'gh_token'], ['set', '1X'], ['set', 'GH_TOKEN', VALUE], ['remove'], ['nope'], []]
        for (const args of bad) {
            await expect(sharedEnvCommand(args, async () => VALUE)).rejects.toThrow('Usage: rerun shared-env')
        }
        expect(existsSync(sharedFile())).toBe(false)
    })

    it('refuses an empty stdin and changes nothing', async () => {
        await expect(sharedEnvCommand(['set', 'GH_TOKEN'], async () => '   ')).rejects.toThrow('No value on stdin; nothing changed.')
        expect(existsSync(sharedFile())).toBe(false)
    })

    it('removes a name, and says so when it was not set', async () => {
        await sharedEnvCommand(['set', 'GH_TOKEN'], async () => VALUE)
        out = ''
        await sharedEnvCommand(['remove', 'GH_TOKEN'])
        await sharedEnvCommand(['remove', 'GH_TOKEN'])
        expect(out).toBe('Removed GH_TOKEN.\nGH_TOKEN was not set; nothing changed.\n')
    })

    it('runs a command with the shared variables and passes on its exit code', async () => {
        await sharedEnvCommand(['set', 'GH_TOKEN'], async () => VALUE)
        await sharedEnvCommand(['run', 'sh', '-c', `test "$GH_TOKEN" = ${VALUE} && exit 3`])
        expect(process.exitCode).toBe(3)
        await expect(sharedEnvCommand(['run', 'no-such-command-1284'])).rejects.toThrow('Cannot run no-such-command-1284: ENOENT')
    })
})
