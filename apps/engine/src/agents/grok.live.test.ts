// Against the real Grok subscription: skipped unless `RERUN_LIVE=1` and `GROK_LIVE_ENV` names the
// `.env` of a signed-in Grok connection (the five GROK_OAUTH_* keys). xAI rotates the refresh token
// on every refresh, so the file is written back with the tokens the run ends on:
//
//   RERUN_LIVE=1 GROK_LIVE_ENV=/path/to/grok.env pnpm --filter rerun-engine exec vitest run src/agents/grok.live.test.ts
//
// Run it before a release: the proxy and its headers are not documented and can change unannounced.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-grok-live-'))

const { afterAll, describe, expect, it } = await import('vitest')
const { generateText, stepCountIs, streamText, tool } = await import('ai')
const { z } = await import('zod')
const { GROK_CLIENT_VERSION, GROK_PROXY_BASE_URL, agentConfigSchema, connectionConfigSchema } = await import('@rerun/contracts')
const { connectionConfigPath, connectionDir, connectionEnvPath } = await import('../config/paths.js')
const { getConnection } = await import('../connections/registry.js')
const { ensureGrokToken, grokAccessToken } = await import('../connections/grok-token.js')
const { readEnvFile } = await import('../lib/env-file.js')
const { resolveModel } = await import('./providers.js')
const { effortProviderOptions, mergeProviderOptions, reasoningProviderOptions } = await import('./reasoning.js')
const { grokFetch } = await import('./grok.js')

const SOURCE = process.env.GROK_LIVE_ENV ?? ''
const LIVE = process.env.RERUN_LIVE === '1' && SOURCE.length > 0 && existsSync(SOURCE)
const ID = 'grok-live'

async function connection() {
    if (!existsSync(connectionDir(ID))) {
        mkdirSync(connectionDir(ID), { recursive: true })
        writeFileSync(connectionConfigPath(ID), JSON.stringify(connectionConfigSchema.parse({ name: 'Grok', provider: 'grok', models: ['grok-4.6', 'grok-4.5'], createdAt: new Date().toISOString() })))
        copyFileSync(SOURCE, connectionEnvPath(ID))
    }
    return getConnection(ID)
}

async function agentOn(model: string) {
    const resolved = { connection: await connection(), provider: 'grok' as const, model }
    return { id: 'live', config: agentConfigSchema.parse({ name: 'live', provider: 'grok', model }), soul: '', install: '', env: {}, resolved } as any
}

const session = () => `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function red(size = 64): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const length = Buffer.alloc(4)
        length.writeUInt32BE(data.length)
        const typed = Buffer.concat([Buffer.from(type), data])
        const crc = Buffer.alloc(4)
        crc.writeUInt32BE(crc32(typed))
        return Buffer.concat([length, typed, crc])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(size, 0)
    header.writeUInt32BE(size, 4)
    header[8] = 8
    header[9] = 2
    const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [220, 20, 20]).flat())])
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))), chunk('IEND', Buffer.alloc(0))])
}

describe.skipIf(!LIVE)('Grok, live', () => {
    afterAll(async () => {
        if (existsSync(connectionEnvPath(ID))) copyFileSync(connectionEnvPath(ID), SOURCE)
    })

    it('renews the sign-in and keeps the lineage on disk', async () => {
        const grok = await connection()
        const before = grokAccessToken(grok)
        await ensureGrokToken(grok, { rejectedToken: before })
        expect(grokAccessToken(grok)).not.toBe(before)
        expect((await readEnvFile(connectionEnvPath(ID))).GROK_OAUTH_TOKEN).toBe(grokAccessToken(grok))
    }, 30_000)

    it('is not too old a client for the proxy', async () => {
        const response = await grokFetch({ connection: await connection(), sessionId: session() })(`${GROK_PROXY_BASE_URL}/settings`, {})
        const { min_client_version: minimum } = (await response.json()) as { min_client_version?: string }
        expect(minimum, `the proxy wants ${minimum}, the engine sends ${GROK_CLIENT_VERSION}`).toBeDefined()
        const [a, b] = [GROK_CLIENT_VERSION, minimum!].map(version => version.split('.').map(Number))
        expect(a![0]! * 1e6 + a![1]! * 1e3 + a![2]! >= b![0]! * 1e6 + b![1]! * 1e3 + b![2]!).toBe(true)
    }, 30_000)

    it('runs a tool loop with parallel calls, its reasoning and an effort', async () => {
        const agent = await agentOn('grok-4.6')
        const { model } = resolveModel(agent, undefined, undefined, undefined, { sessionId: session() })
        const result = streamText({
            model,
            prompt: 'Call get_weather for Paris and for Lyon in parallel, then add_numbers with the two temperatures, then answer in one sentence.',
            tools: {
                get_weather: tool({ description: 'Weather for a city', inputSchema: z.object({ city: z.string() }), execute: async ({ city }) => ({ city, tempC: city === 'Paris' ? 11 : 14 }) }),
                add_numbers: tool({ description: 'Add two numbers', inputSchema: z.object({ a: z.number(), b: z.number() }), execute: async ({ a, b }) => a + b }),
            },
            stopWhen: stepCountIs(6),
            providerOptions: mergeProviderOptions(reasoningProviderOptions('grok', 'grok-4.6'), effortProviderOptions('grok', 'low')),
        })
        const steps = await result.steps
        expect(steps[0]!.toolCalls).toHaveLength(2)
        expect(await result.text).toMatch(/25/)
        expect(steps.some(step => step.reasoning.length > 0)).toBe(true)
    }, 120_000)

    it('sees an image, and a one-shot call goes through as well', async () => {
        const agent = await agentOn('grok-4.6')
        const { model } = resolveModel(agent, undefined, undefined, undefined, { sessionId: session() })
        const { text } = await generateText({ model, messages: [{ role: 'user', content: [{ type: 'text', text: 'What single color fills this image? One word.' }, { type: 'image', image: red(), mediaType: 'image/png' }] }] })
        expect(text.toLowerCase()).toContain('red')
    }, 120_000)
})
