import { streamText, wrapLanguageModel, type ModelMessage } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedModel } from '../agents/providers.js'
import { createScreenBudget, type ScreenBudget } from './screen-budget.js'
import { CARRY_ON_NOTE, acrossScreenStretches, type StretchOptions } from './screen-stretches.js'

type Part = Record<string, unknown>
// A function runs once every part before it was read, as the tool calls of a session do.
type Session = { parts: Array<Part | (() => unknown)>; fails?: Error; queue?: Session['parts'] }

const usage = (input: number, cached: number, output: number) => ({ inputTokens: { total: input, noCache: input - cached, cacheRead: cached, cacheWrite: 0 }, outputTokens: { total: output, text: output, reasoning: undefined } })
const finish = (reason = 'stop', tokens = usage(100, 80, 10)): Part => ({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage: tokens, providerMetadata: { session: { reason } } })
const text = (value: string, id = '0'): Part[] => [{ type: 'text-start', id }, { type: 'text-delta', id, delta: value }, { type: 'text-end', id }]
const call = (toolCallId: string, toolName: string, input: unknown, result: unknown): Part[] => [
    { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input), providerExecuted: true, dynamic: true },
    { type: 'tool-result', toolCallId, toolName, result, dynamic: true },
]
const click = (id: string) => call(id, 'mcp__rerun__computer', { action: 'left_click', coordinate: [1, 2] }, { status: 'done', screen: [1280, 720], screenshotId: `pic-${id}`, screenshotPath: `/tmp/${id}.jpg`, next: 'Open screenshotPath with view_image' })

let budget: ScreenBudget
let controller: AbortController
let prompts: Array<{ prompt: Array<{ role: string; content: any }>; providerOptions: any }>
let closes: number[]
let sessions: Session[]

function spendStretch(): void {
    for (let i = 0; i < budget.perStretch; i++) {
        budget.take()
        budget.saw(Buffer.alloc(57_600).fill(255, (prompts.length * 60 + i) * 90, (prompts.length * 60 + i) * 90 + 200))
    }
    budget.take()
}

function build(options: Partial<StretchOptions> = {}) {
    let opened = 0
    const open = (): ResolvedModel => {
        const index = opened++
        const session = sessions[index]!
        const model = new MockLanguageModelV3({
            doStream: async params => {
                prompts.push({ prompt: params.prompt as never, providerOptions: params.providerOptions })
                if (session.fails) throw session.fails
                return {
                    stream: new ReadableStream(
                        {
                            pull(c) {
                                const queue = (session.queue ??= [{ type: 'stream-start', warnings: [] }, ...session.parts])
                                let next = queue.shift()
                                while (typeof next === 'function') {
                                    next()
                                    next = queue.shift()
                                }
                                if (!next) c.close()
                                else if (next.type === 'throw') c.error(next.error)
                                else c.enqueue(next as never)
                            },
                        },
                        { highWaterMark: 0 },
                    ),
                }
            },
        })
        return { model: wrapLanguageModel({ model, middleware: [] }), close: async () => void closes.push(index), contextUsage: () => ({ usedTokens: index, maxTokens: 10 }), quickReplies: () => ({ toolCallId: `q${index}`, replies: [`reply ${index}`] }) }
    }
    const between = vi.fn(async () => {})
    const resolved = acrossScreenStretches(open, { budget, signal: controller.signal, teardown: close => close(), betweenStretches: between, fit: work => work, ...options })
    return { resolved, between, opened: () => opened }
}

async function run(resolved: ResolvedModel, providerOptions?: any) {
    const errors: unknown[] = []
    const result = streamText({ model: resolved.model, system: 'sys', messages: [{ role: 'user', content: 'Fill the page' }], providerOptions, onError: ({ error }) => void errors.push(error) })
    const parts: any[] = []
    try {
        for await (const part of result.fullStream) parts.push(part)
    } catch (error) {
        errors.push(error)
    }
    return { result, parts, errors }
}

beforeEach(() => {
    budget = createScreenBudget('claude')
    controller = new AbortController()
    prompts = []
    closes = []
    sessions = []
})

describe('a run on a CLI past the screenshots of one stretch', () => {
    it('answers as one call when it never ran out', async () => {
        sessions = [{ parts: [...text('Done.'), finish()] }]
        const { resolved, opened, between } = build()
        const { result } = await run(resolved)
        expect(await result.text).toBe('Done.')
        expect(opened()).toBe(1)
        expect(between).not.toHaveBeenCalled()
    })

    it('carries on in a new session, in the same answer, with the usage of both', async () => {
        sessions = [
            { parts: [...text('Filling.'), ...click('t1'), spendStretch, ...text('NOTE: 8 of 12 blocks filled.', '1'), finish()] },
            { parts: [...click('t2'), ...text('All filled.'), finish('stop', usage(40, 10, 5))] },
        ]
        const { resolved, between } = build()
        const { result, parts } = await run(resolved)

        expect((await result.steps).length).toBe(1)
        expect(parts.filter(part => part.type === 'finish')).toHaveLength(1)
        expect(parts.filter(part => part.type === 'start-step')).toHaveLength(1)
        expect(await result.text).toBe('Filling.All filled.')
        expect(await result.totalUsage).toMatchObject({ inputTokens: 140, cachedInputTokens: 90, outputTokens: 15 })
        expect(closes).toEqual([0])
        expect(between).toHaveBeenCalledTimes(1)
        expect(resolved.contextUsage?.()).toEqual({ usedTokens: 1, maxTokens: 10 })
        expect(resolved.quickReplies()).toEqual({ toolCallId: 'q1', replies: ['reply 1'] })
    })

    it('tells the new session what was done, results in tool messages and the note last, without one picture', async () => {
        sessions = [{ parts: [{ type: 'reasoning-start', id: 'r' }, { type: 'reasoning-delta', id: 'r', delta: 'thinking' }, { type: 'reasoning-end', id: 'r' }, ...text('Filling.'), ...click('t1'), ...call('t2', 'mcp__rerun__fs_read', { path: 'a.md' }, 'the file'), spendStretch, ...text('NOTE: go on.', '1'), finish()] }, { parts: [...text('ok'), finish()] }]
        await run(build().resolved)

        const [, second] = prompts
        expect(second.prompt.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'user'])
        const json = JSON.stringify(second.prompt)
        expect(json).not.toMatch(/pic-t1|t1\.jpg|view_image|thinking/)
        expect(second.prompt[3].content[0].output).toEqual({ type: 'json', value: { status: 'done' } })
        expect(second.prompt[5].content[0].output).toEqual({ type: 'text', value: 'the file' })
        expect(second.prompt[6].content[0].text).toBe('NOTE: go on.')
        expect(second.prompt[7].content[0].text).toBe(CARRY_ON_NOTE)
    })

    it('hands a third session the work of the first two', async () => {
        sessions = [{ parts: [...text('one'), spendStretch, ...text('NOTE 1', '1'), finish()] }, { parts: [...text('two'), spendStretch, ...text('NOTE 2', '1'), finish()] }, { parts: [...text('three'), finish()] }]
        const { result } = await run(build().resolved)
        expect(await result.text).toBe('onetwothree')
        expect(prompts[2].prompt.map(message => message.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user'])
        expect(closes).toEqual([0, 1])
    })

    it('gives a new name to the ids a new session uses again', async () => {
        sessions = [{ parts: [...click('t1'), ...text('one'), spendStretch, finish()] }, { parts: [...click('t1'), ...text('two'), finish()] }]
        const { parts } = await run(build().resolved)
        expect(parts.filter(part => part.type === 'tool-call').map(part => part.toolCallId)).toEqual(['t1', 't1-2'])
        expect(parts.filter(part => part.type === 'tool-result').map(part => part.toolCallId)).toEqual(['t1', 't1-2'])
        expect(parts.filter(part => part.type === 'text-delta').map(part => part.id)).toEqual(['0', '0-2'])
    })

    it('opens a thread of its own on codex', async () => {
        sessions = [{ parts: [...text('one'), spendStretch, finish()] }, { parts: [...text('two'), finish()] }]
        await run(build().resolved, { 'codex-app-server': { threadId: 'old', effort: 'high' }, other: { a: 1 } })
        expect(prompts[0].providerOptions['codex-app-server']).toEqual({ threadId: 'old', effort: 'high' })
        expect(prompts[1].providerOptions).toEqual({ 'codex-app-server': { effort: 'high' }, other: { a: 1 } })
    })

    it('sends what fits', async () => {
        sessions = [{ parts: [...text('one'), spendStretch, finish()] }, { parts: [...text('two'), finish()] }]
        const fitted: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'shortened' }] }]
        await run(build({ fit: () => fitted }).resolved)
        expect(prompts[1].prompt.at(-1)).toMatchObject({ content: [{ text: 'shortened' }] })
    })

    it('stops on a card, which waits for someone', async () => {
        sessions = [{ parts: [spendStretch, ...text('I need you.'), ...call('h1', 'mcp__rerun__ask_user', { questions: [] }, 'asked'), finish()] }]
        const { resolved, opened } = build()
        const { parts } = await run(resolved)
        expect(opened()).toBe(1)
        expect(parts.filter(part => part.type === 'finish')).toHaveLength(1)
        expect(parts.filter(part => part.type === 'text-delta' || part.type === 'tool-call').map(part => part.text ?? part.toolName)).toEqual(['I need you.', 'mcp__rerun__ask_user'])
    })

    it.each(['error', 'other', 'length'])('stops on a session that ended on %s', async reason => {
        sessions = [{ parts: [spendStretch, ...text('cut'), finish(reason)] }]
        const { resolved, opened } = build()
        const { parts } = await run(resolved)
        expect(opened()).toBe(1)
        expect(parts.filter(part => part.type === 'text-delta').map(part => part.text)).toEqual(['cut'])
    })

    it('shows what was held back when the session breaks', async () => {
        sessions = [{ parts: [...text('one'), spendStretch, ...text(' NOTE', '1'), { type: 'throw', error: new Error('pipe closed') }] }]
        const { parts, errors } = await run(build().resolved)
        expect(errors).toEqual([new Error('pipe closed')])
        expect(parts.filter(part => part.type === 'text-delta').map(part => part.text)).toEqual(['one', ' NOTE'])
    })

    it('holds back no text whose block had already opened', async () => {
        const [start, delta, end] = text('Filling')
        sessions = [{ parts: [start, spendStretch, delta, end, ...text('NOTE', '1'), finish()] }, { parts: [...text('done'), finish()] }]
        const { result } = await run(build().resolved)
        expect(await result.text).toBe('Fillingdone')
    })

    it('stops on a run that was going in circles', async () => {
        sessions = [{ parts: [() => { for (let i = 0; i < 61; i++) budget.take() }, ...text('I am stuck.'), finish()] }]
        const { resolved, opened } = build()
        const { result } = await run(resolved)
        expect(opened()).toBe(1)
        expect(await result.text).toBe('I am stuck.')
    })

    it('opens nothing once Stop was pressed, before or while the session changes', async () => {
        for (const stopAt of ['before', 'during'] as const) {
            budget = createScreenBudget('claude')
            controller = new AbortController()
            prompts = []
            sessions = [{ parts: [...text('one'), spendStretch, () => stopAt === 'before' && controller.abort(), finish()] }]
            const { resolved, opened } = build({ betweenStretches: async () => controller.abort() })
            await run(resolved)
            expect(opened(), stopAt).toBe(1)
        }
    })

    it('opens nothing once the run closed it, and closes the session that is open', async () => {
        sessions = [{ parts: [...text('one'), spendStretch, finish()] }, { parts: [...text('two'), finish()] }]
        const closing: { resolved?: ResolvedModel } = {}
        const first = build({ betweenStretches: async () => closing.resolved?.close() })
        closing.resolved = first.resolved
        await run(first.resolved)
        expect(first.opened()).toBe(1)

        prompts = []
        closes = []
        budget = createScreenBudget('claude')
        sessions = [{ parts: [...text('one'), spendStretch, finish()] }, { parts: [...text('two'), finish()] }]
        const second = build()
        await run(second.resolved)
        await second.resolved.close()
        expect(closes).toEqual([0, 1])
    })

    it.each([
        ['the new session cannot start', { fails: new Error('session limit') }, {}],
        ['the sign-in expired', {}, { betweenStretches: async () => { throw new Error('session limit') } }],
    ])('fails as any run when %s, keeping what was said', async (_name, next, options) => {
        sessions = [{ parts: [...text('one'), spendStretch, ...text(' NOTE', '1'), finish()] }, { parts: [], ...next }]
        const { parts, errors } = await run(build(options).resolved)
        expect(errors).toEqual([new Error('session limit')])
        expect(parts.filter(part => part.type === 'text-delta').map(part => part.text)).toEqual(['one', ' NOTE'])
    })
})
