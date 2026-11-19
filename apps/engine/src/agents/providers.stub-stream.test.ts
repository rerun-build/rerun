import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-stub-stream-'))
delete process.env.OPENAI_BASE_URL

const { afterAll, beforeAll, describe, expect, it } = await import('vitest')
const { streamText } = await import('ai')
const { agentConfigSchema, connectionConfigSchema } = await import('@moldwright/contracts')
const { resolveModel } = await import('./providers.js')

const STUB = resolve(import.meta.dirname, '../../../../tools/factory/stub_model.py')
const python = spawnSync('python3', ['--version']).status === 0

function agentOnStub(baseUrl: string, model: string) {
    const config = connectionConfigSchema.parse({ name: 'stub', provider: 'custom', createdAt: new Date().toISOString(), baseUrl })
    return {
        id: 'agent-stub',
        config: agentConfigSchema.parse({ name: 'p', provider: 'custom', model }),
        soul: '',
        install: '',
        env: {},
        resolved: { connection: { id: 'stub-cnx', config, env: {} }, provider: 'custom', model },
    } as any
}

describe.skipIf(!python)('the factory stub model through the custom provider', () => {
    let child: ChildProcess
    let baseUrl = ''

    beforeAll(async () => {
        child = spawn('python3', [STUB, '0'], { env: { ...process.env, STUB_HOLD_SECONDS: '0.2' }, stdio: ['ignore', 'pipe', 'inherit'] })
        const line = await new Promise<string>(done => createInterface({ input: child.stdout! }).once('line', done))
        baseUrl = `http://127.0.0.1:${line.match(/(\d+)$/)![1]}/v1`
    })

    afterAll(() => {
        child.kill()
    })

    it.each(['stub-fast', 'stub-hold'])('streams %s to a finished step with text and usage', async model => {
        const result = streamText({ model: resolveModel(agentOnStub(baseUrl, model)).model, prompt: 'hello' })

        expect(await result.text).toBe('stub reply')
        expect(await result.finishReason).toBe('stop')
        expect((await result.usage).totalTokens).toBe(2)
    })
})
