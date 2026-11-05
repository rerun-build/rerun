import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-vision-'))

const { model } = vi.hoisted(() => ({
    model: { hang: false, prompts: [] as unknown[], calls: [] as unknown[][] },
}))

vi.mock('../../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...actual,
        modelFor: (...args: unknown[]) => {
            model.calls.push(args)
            return new MockLanguageModelV3({
                doGenerate: async options => {
                    model.prompts.push(options.prompt)
                    // Deaf to the abort signal on purpose: the call that held a run for hours had
                    // no socket left to cancel.
                    if (model.hang) return new Promise(() => {})
                    return {
                        content: [{ type: 'text', text: 'a ring on a white background' }],
                        finishReason: { unified: 'stop', raw: 'stop' },
                        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
                        warnings: [],
                    }
                },
            })
        },
    }
})

const { afterEach, describe, expect, it } = await import('vitest')
const sharp = (await import('sharp')).default
const { workspaceDir } = await import('../../config/paths.js')
const { visionTools } = await import('./vision.js')

const agentId = 'viewer'
const uploads = resolve(workspaceDir(agentId), 'chat-uploads')
mkdirSync(uploads, { recursive: true })

function ctxWith(abortSignal?: AbortSignal) {
    return { agent: { id: agentId, resolved: { provider: 'rerun' } }, sessionId: 's', logger: { warn: () => {} }, abortSignal } as any
}

async function analyze(ctx: ReturnType<typeof ctxWith>, imagePath: string, timeoutMs?: number): Promise<string> {
    return (await (visionTools(ctx, timeoutMs).vision_analyze as any).execute({ imagePath, prompt: 'What is it?' }, { toolCallId: 'call-1', messages: [] })) as string
}

function sentImage(): { data: Uint8Array; mediaType: string } {
    const prompt = model.prompts.at(-1) as Array<{ role: string; content: Array<{ type: string; data: Uint8Array; mediaType: string }> }>
    const file = prompt.flatMap(m => (Array.isArray(m.content) ? m.content : [])).find(p => p.type === 'file')
    if (!file) throw new Error('no image reached the model')
    return file
}

async function png(name: string, width: number, height: number): Promise<void> {
    const image = await sharp({ create: { width, height, channels: 3, background: '#c0ffee' } }).png().toBuffer()
    writeFileSync(resolve(uploads, name), image)
}

afterEach(() => {
    model.hang = false
    model.prompts.length = 0
    model.calls.length = 0
})

describe('vision_analyze', () => {
    it('scales a large image down to 2048px before sending it', async () => {
        await png('large.png', 4000, 3000)

        expect(await analyze(ctxWith(), 'chat-uploads/large.png')).toBe('a ring on a white background')

        const sent = sentImage()
        expect(sent.mediaType).toBe('image/webp')
        const { width, height } = await sharp(Buffer.from(sent.data)).metadata()
        expect(Math.max(width!, height!)).toBe(2048)
    })

    it('sends a small image as it is', async () => {
        await png('small.png', 400, 300)

        await analyze(ctxWith(), 'chat-uploads/small.png')

        expect(sentImage().mediaType).toBe('image/png')
    })

    it('says a file that is not an image cannot be read', async () => {
        writeFileSync(resolve(uploads, 'broken.png'), 'not an image')

        expect(await analyze(ctxWith(), 'chat-uploads/broken.png')).toMatch(/^Could not read chat-uploads\/broken\.png as an image/)
        expect(model.prompts).toHaveLength(0)
    })

    it('gives up on a model that never answers', async () => {
        await png('slow.png', 400, 300)
        model.hang = true

        expect(await analyze(ctxWith(), 'chat-uploads/slow.png', 50)).toMatch(/^Vision analysis timed out/)
    })

    it('lets a stopped run end while the model is still silent', async () => {
        await png('stopped.png', 400, 300)
        model.hang = true
        const run = new AbortController()

        const pending = analyze(ctxWith(run.signal), 'chat-uploads/stopped.png')
        setTimeout(() => run.abort(), 20)

        await expect(pending).rejects.toBeDefined()
    })
})

describe('vision_analyze on an OpenCode model that cannot see', () => {
    const openCodeCtx = (models: string[]) =>
        ({
            agent: { id: agentId, resolved: { provider: 'opencode', model: 'go/deepseek-v4-pro', connection: { id: 'oc', config: { provider: 'opencode', models }, env: {} } } },
            sessionId: 'session-9',
            logger: { warn: () => {} },
        }) as any

    it('asks a model of the same connection that sees, in the same conversation', async () => {
        await png('small.png', 40, 30)
        expect(await analyze(openCodeCtx(['go/deepseek-v4-pro', 'go/kimi-k3.1-pro']), 'chat-uploads/small.png')).toBe('a ring on a white background')
        const [, override, , , options] = model.calls.at(-1) as [unknown, { model: string }, unknown, unknown, { sessionId: string }]
        expect(override).toEqual({ model: 'go/kimi-k3.1-pro' })
        expect(options.sessionId).toBe('session-9')
    })

    it('says so plainly when none of its models sees, without calling one', async () => {
        await png('small.png', 40, 30)
        expect(await analyze(openCodeCtx(['go/deepseek-v4-pro', 'go/glm-5.3']), 'chat-uploads/small.png')).toContain('None of the models switched on for this OpenCode connection can read images')
        expect(model.calls).toHaveLength(0)
    })
})
