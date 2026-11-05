// Against the real OpenCode, with a real key: skipped unless both `RERUN_LIVE=1` and
// `OPENCODE_API_KEY` are set (`apps/engine/.env` is read by the engine's own env loader, not here):
//
//   RERUN_LIVE=1 OPENCODE_API_KEY=oc_sk_… pnpm --filter rerun-engine exec vitest run src/agents/opencode.live.test.ts
//
// Writes what every Go model managed to `.context/opencode/compat.md` at the repo root.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-opencode-live-'))

const { describe, expect, it } = await import('vitest')
const { generateText, stepCountIs, streamText, tool } = await import('ai')
const { z } = await import('zod')
const { OPENCODE_CATALOG_URL, OPENCODE_SNAPSHOT, OPENCODE_USAGE_URL, agentConfigSchema, connectionConfigSchema, parseOpencodeCatalog } = await import('@rerun/contracts')
const { resolveModel } = await import('./providers.js')
const { reasoningProviderOptions } = await import('./reasoning.js')
const { refreshOpencodeCatalog, opencodeModels } = await import('../connections/opencode-catalog.js')

const KEY = process.env.OPENCODE_API_KEY ?? ''
const LIVE = process.env.RERUN_LIVE === '1' && KEY.length > 0
const REPORT = resolve(import.meta.dirname, '../../../../.context/opencode/compat.md')

function agentOn(model: string) {
    const connection = { id: 'oc-live', config: connectionConfigSchema.parse({ name: 'OpenCode', provider: 'opencode', models: [model], createdAt: new Date().toISOString() }), env: { OPENCODE_API_KEY: KEY } }
    return { id: 'live', config: agentConfigSchema.parse({ name: 'live', provider: 'opencode', model }), soul: '', install: '', env: {}, resolved: { connection, provider: 'opencode' as const, model } } as any
}

const session = () => `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

type Check = 'text' | 'stream' | 'tool loop' | 'parallel' | 'big argument' | 'reasoning' | 'billing' | 'image'
const CHECKS: Check[] = ['text', 'stream', 'tool loop', 'parallel', 'big argument', 'reasoning', 'billing', 'image']

async function attempt(fn: () => Promise<boolean | 'n/a'>): Promise<string> {
    try {
        const outcome = await fn()
        return outcome === 'n/a' ? 'n/a' : outcome ? 'ok' : 'FAIL'
    } catch (error) {
        return `FAIL: ${String((error as Error).message ?? error).slice(0, 80).replace(/\|/g, '/')}`
    }
}

describe.skipIf(!LIVE)('OpenCode, live', () => {
    it('parses both catalogs without loss, and says when the snapshot is behind', async () => {
        await refreshOpencodeCatalog()
        for (const plan of ['go', 'console'] as const) {
            const body = (await (await fetch(OPENCODE_CATALOG_URL[plan])).json()) as { data: unknown[] }
            const parsed = parseOpencodeCatalog(body, plan)
            expect(parsed.length).toBeGreaterThan(0)
            const snapshot = new Set(OPENCODE_SNAPSHOT.filter(model => model.plan === plan).map(model => model.id))
            const drift = parsed.filter(model => !snapshot.has(model.id)).map(model => model.id)
            if (drift.length) console.warn(`[opencode] ${plan}: not in the snapshot yet, run scripts/opencode-snapshot.mjs: ${drift.join(', ')}`)
        }
    }, 30_000)

    it('reads the Go usage with the key, and refuses a wrong one', async () => {
        const good = await fetch(OPENCODE_USAGE_URL, { headers: { Authorization: `Bearer ${KEY}` } })
        expect(good.status).toBe(200)
        expect(await good.json()).toHaveProperty('usage')
        const bad = await fetch(OPENCODE_USAGE_URL, { headers: { Authorization: 'Bearer oc_sk_wrong' } })
        expect(bad.status).toBe(401)
    }, 30_000)

    it('runs every Go model through the Rerun provider', async () => {
        await refreshOpencodeCatalog()
        const rows: string[] = []
        for (const model of opencodeModels().filter(entry => entry.plan === 'go')) {
            const agent = agentOn(model.id)
            const live = (sessionId = session()) => resolveModel(agent, undefined, undefined, undefined, { sessionId }).model
            const results: Record<Check, string> = {
                text: await attempt(async () => /pong/i.test((await generateText({ model: live(), prompt: 'Answer with the single word: pong' })).text)),
                stream: await attempt(async () => (await streamText({ model: live(), prompt: 'Count from 1 to 5.' }).text).includes('5')),
                'tool loop': await attempt(async () => {
                    const weather = tool({ description: 'Weather of a city', inputSchema: z.object({ city: z.string() }), execute: async () => 'It is 17 degrees and sunny.' })
                    const { text } = await generateText({ model: live(), tools: { weather }, stopWhen: stepCountIs(3), prompt: 'Use the weather tool for Paris, then tell me the temperature.' })
                    return text.includes('17')
                }),
                parallel: await attempt(async () => {
                    const weather = tool({ description: 'Weather of a city', inputSchema: z.object({ city: z.string() }), execute: async ({ city }) => `${city}: 20 degrees` })
                    const { steps } = await generateText({ model: live(), tools: { weather }, stopWhen: stepCountIs(3), prompt: 'Call the weather tool for Paris and for Rome at the same time, in one step.' })
                    return (steps[0]?.toolCalls.length ?? 0) >= 2
                }),
                'big argument': await attempt(async () => {
                    let written = 0
                    const write = tool({ description: 'Write a file', inputSchema: z.object({ path: z.string(), content: z.string() }), execute: async ({ content }) => ((written = content.length), 'saved') })
                    await generateText({ model: live(), tools: { write }, stopWhen: stepCountIs(2), prompt: 'Write a 6000-word essay on the history of the printing press to essay.md with the write tool, in one call.' })
                    return written > 16_000
                }),
                reasoning: await attempt(async () => {
                    if (!model.reasoning) return 'n/a'
                    const result = streamText({ model: live(), prompt: 'Is 9.11 bigger than 9.9? Think, then answer.', providerOptions: reasoningProviderOptions('opencode', model.id) })
                    return ((await result.reasoningText) ?? '').length > 0
                }),
                billing: await attempt(async () => {
                    const result = streamText({ model: live(), prompt: 'Say hi.' })
                    const metadata = (await result.providerMetadata) as { opencode?: { billingSource?: string; cost?: number } } | undefined
                    return metadata?.opencode?.billingSource === 'go' && metadata.opencode.cost === 0
                }),
                image: await attempt(async () => {
                    if (!model.images) return 'n/a'
                    const sharp = (await import('sharp')).default
                    const red = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } }).png().toBuffer()
                    const { text } = await generateText({ model: live(), messages: [{ role: 'user', content: [{ type: 'image', image: red, mediaType: 'image/png' }, { type: 'text', text: 'What color is this square? One word.' }] }] })
                    return /red/i.test(text)
                }),
            }
            const recommended = results['tool loop'] === 'ok' && results['big argument'] === 'ok'
            rows.push(`| ${model.id} | ${model.wire} | ${CHECKS.map(check => results[check]).join(' | ')} | ${recommended ? 'yes' : '**not recommended**'} |`)
        }
        mkdirSync(resolve(REPORT, '..'), { recursive: true })
        writeFileSync(REPORT, [`# OpenCode Go compatibility (${new Date().toISOString()})`, '', `| model | wire | ${CHECKS.join(' | ')} | recommended |`, `|${' --- |'.repeat(CHECKS.length + 3)}`, ...rows, ''].join('\n'))
        expect(rows.length).toBeGreaterThan(0)
    }, 60 * 60_000)

    it('answers an unknown id and a Console model on the Go URL with "Model is unavailable"', async () => {
        for (const model of ['not-a-real-model-xyz', 'claude-opus-5-5']) {
            const response = await fetch('https://opencode.ai/inference/go/openai/v1/chat/completions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'x-opencode-session': session() },
                body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
            })
            expect(response.status, model).toBe(400)
            expect(await response.text(), model).toMatch(/model is unavailable/i)
        }
    }, 30_000)
})
