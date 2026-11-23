import type { Provider } from '@rerun/contracts'
import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { thoughtsOf } from './__fixtures__/thoughts.js'
import { createScreenshotStore, stepWithScreenshots, withScreenshots } from './screenshots.js'

const picture = (label: string) => ({ image: Buffer.from(label), mediaType: 'image/jpeg' })

const toolResult = (toolCallId: string, value: unknown): ModelMessage => ({
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId, toolName: 'computer', output: { type: 'json', value: value as never } }],
})

describe('screenshot store', () => {
    it('hands back what it was given under the id it returned', () => {
        const store = createScreenshotStore()
        const id = store.add(picture('one'))
        expect(store.get(id)?.image.toString()).toBe('one')
        expect(store.get('unknown')).toBeUndefined()
    })

    it('keeps six pictures, then drops down to the three latest in one go', () => {
        const store = createScreenshotStore()
        const ids = Array.from({ length: 6 }, (_, index) => store.add(picture(String(index))))
        expect(ids.every(id => store.get(id))).toBe(true)
        const seventh = store.add(picture('6'))
        expect(ids.slice(0, 4).some(id => store.get(id))).toBe(false)
        expect([...ids.slice(4), seventh].every(id => store.get(id))).toBe(true)
    })
})

describe('withScreenshots', () => {
    it('leaves a conversation without screenshots exactly as it is', () => {
        const store = createScreenshotStore()
        const messages: ModelMessage[] = [
            { role: 'user', content: 'hello' },
            toolResult('c1', { status: 'refused', reason: 'no' }),
            toolResult('c2', null),
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c3', toolName: 'shell_exec', output: { type: 'text', value: 'ok' } }] },
        ]
        expect(withScreenshots(messages, store, 'tool-result')).toEqual(messages)
        expect(withScreenshots(messages, store, 'user-message')).toEqual(messages)
    })

    it('puts the picture inside the tool result for a provider that reads one there', () => {
        const store = createScreenshotStore()
        const id = store.add(picture('screen'))
        const value = { status: 'done', screenshotId: id, screen: [1280, 720] }
        const [message] = withScreenshots([toolResult('c1', value)], store, 'tool-result')
        expect(message).toEqual({
            role: 'tool',
            content: [
                {
                    type: 'tool-result',
                    toolCallId: 'c1',
                    toolName: 'computer',
                    output: {
                        type: 'content',
                        value: [
                            { type: 'text', text: JSON.stringify(value) },
                            { type: 'image-data', data: Buffer.from('screen').toString('base64'), mediaType: 'image/jpeg' },
                        ],
                    },
                },
            ],
        })
    })

    it('follows the tool message with a user message carrying the picture for a chat-completions provider', () => {
        const store = createScreenshotStore()
        const id = store.add(picture('screen'))
        const result = toolResult('c1', { status: 'done', screenshotId: id })
        const next: ModelMessage = { role: 'assistant', content: 'done' }
        expect(withScreenshots([result, next], store, 'user-message')).toEqual([
            result,
            {
                role: 'user',
                content: [
                    { type: 'text', text: `Screenshot ${id}, your screen as that action left it:` },
                    { type: 'image', image: Buffer.from('screen'), mediaType: 'image/jpeg' },
                ],
            },
            next,
        ])
    })

    it('leaves a result whose picture was dropped as the text it always was', () => {
        const store = createScreenshotStore()
        const stale = store.add(picture('old'))
        for (let i = 0; i < 6; i++) store.add(picture(String(i)))
        const messages = [toolResult('c1', { status: 'done', screenshotId: stale })]
        expect(withScreenshots(messages, store, 'tool-result')).toEqual(messages)
    })

    it('only touches the results that name a picture when a step ran several tools', () => {
        const store = createScreenshotStore()
        const id = store.add(picture('screen'))
        const message: ModelMessage = {
            role: 'tool',
            content: [
                { type: 'tool-result', toolCallId: 'c1', toolName: 'shell_exec', output: { type: 'text', value: 'ok' } },
                { type: 'tool-result', toolCallId: 'c2', toolName: 'computer', output: { type: 'json', value: { screenshotId: id } } },
            ],
        }
        const [out] = withScreenshots([message], store, 'tool-result') as Array<Extract<ModelMessage, { role: 'tool' }>>
        expect(out!.content[0]).toEqual(message.content[0])
        expect((out!.content[1] as { output: { type: string } }).output.type).toBe('content')
    })
})

describe('stepWithScreenshots', () => {
    it('changes nothing in a run that never looked at a screen', () => {
        expect(stepWithScreenshots([{ role: 'user', content: 'hello' }], undefined, 'anthropic')).toEqual({})
    })

    it.each([
        ['anthropic', 'tool'],
        ['openai', 'tool'],
        ['google', 'tool'],
        ['rerun', 'user'],
        ['openrouter', 'user'],
    ] as const)('hands %s its picture in a %s message', (provider, role) => {
        const store = createScreenshotStore()
        const messages = [toolResult('c1', { screenshotId: store.add(picture('screen')) })]
        expect(stepWithScreenshots(messages, store, provider).messages!.at(-1)!.role).toBe(role)
    })

    it.each([
        ['go/claude-haiku-5-5', 'tool'],
        ['go/gpt-6-luna', 'tool'],
        ['go/gemini-4-argon', 'tool'],
        ['go/kimi-k3.1-pro', 'user'],
    ] as const)('hands OpenCode %s its picture the way its format takes it, in a %s message', (model, role) => {
        const store = createScreenshotStore()
        const messages = [toolResult('c1', { screenshotId: store.add(picture('screen')) })]
        expect(stepWithScreenshots(messages, store, 'opencode', model).messages!.at(-1)!.role).toBe(role)
    })

    // OpenCode drops an image sent to a model that cannot see without a word.
    it('never attaches a picture for an OpenCode model without vision', () => {
        const store = createScreenshotStore()
        const messages = [toolResult('c1', { screenshotId: store.add(picture('screen')) })]
        expect(stepWithScreenshots(messages, store, 'opencode', 'go/deepseek-v4-pro')).toEqual({})
    })
})

// Anthropic binds a thought to everything before it, and a dropped picture leaves a message that was
// already sent: RER-278.
describe('the signed thinking of a run that looks at its screen', () => {
    const step = (store: ReturnType<typeof createScreenshotStore>, index: number, pictures = 1): ModelMessage[] => [
        {
            role: 'assistant',
            content: [
                { type: 'reasoning', text: `thought ${index}`, providerOptions: { anthropic: { signature: `sig-${index}` } } },
                ...Array.from({ length: pictures }, (_, i) => ({ type: 'tool-call' as const, toolCallId: `c${index}-${i}`, toolName: 'computer', input: {} })),
            ],
        },
        {
            role: 'tool',
            content: Array.from({ length: pictures }, (_, i) => ({ type: 'tool-result' as const, toolCallId: `c${index}-${i}`, toolName: 'computer', output: { type: 'json' as const, value: { screenshotId: store.add(picture(`${index}-${i}`)) } } })),
        },
    ]
    const run = (store: ReturnType<typeof createScreenshotStore>, count: number): ModelMessage[] => [{ role: 'user', content: 'go' }, ...Array.from({ length: count }, (_, index) => step(store, index)).flat()]
    const sentTo = (messages: ModelMessage[], store: ReturnType<typeof createScreenshotStore>, provider: Provider = 'anthropic', model = 'claude-sonnet-5-5') => stepWithScreenshots(messages, store, provider, model).messages!

    it('is replayed as long as every picture is still there', () => {
        const store = createScreenshotStore()
        expect(thoughtsOf(sentTo(run(store, 6), store))).toEqual(['thought 0', 'thought 1', 'thought 2', 'thought 3', 'thought 4', 'thought 5'])
    })

    it('is dropped up to the step whose picture made the older ones leave', () => {
        const store = createScreenshotStore()
        const sent = sentTo(run(store, 7), store)
        expect(thoughtsOf(sent)).toEqual([])
        expect(sent.filter(message => message.role === 'assistant')).toHaveLength(7)
    })

    it('is replayed again behind that step, and stays until pictures leave again', () => {
        const store = createScreenshotStore()
        expect(thoughtsOf(sentTo(run(store, 10), store))).toEqual(['thought 7', 'thought 8', 'thought 9'])
        const longer = createScreenshotStore()
        expect(thoughtsOf(sentTo(run(longer, 11), longer))).toEqual([])
        const again = createScreenshotStore()
        expect(thoughtsOf(sentTo(run(again, 12), again))).toEqual(['thought 11'])
    })

    it('counts the pictures of one step as a single step', () => {
        const store = createScreenshotStore()
        const messages: ModelMessage[] = [{ role: 'user', content: 'go' }, ...run(store, 5).slice(1), ...step(store, 5, 3), ...step(store, 6)]
        expect(thoughtsOf(sentTo(messages, store))).toEqual(['thought 6'])
    })

    it('is left as a summary kept it once the step that made the pictures leave was summarised', () => {
        const store = createScreenshotStore()
        const messages = run(store, 9)
        const behindTheSummary: ModelMessage[] = [{ role: 'user', content: 'summary' }, ...messages.slice(-4)]
        expect(thoughtsOf(sentTo(behindTheSummary, store))).toEqual(['thought 7', 'thought 8'])
    })

    it('is dropped on an OpenCode model served in the Anthropic format', () => {
        const store = createScreenshotStore()
        expect(thoughtsOf(sentTo(run(store, 7), store, 'opencode', 'go/claude-haiku-5-5'))).toEqual([])
    })

    it.each(['openai', 'google'] as const)('is kept on %s, which does not bind it to what came before', provider => {
        const store = createScreenshotStore()
        expect(thoughtsOf(sentTo(run(store, 7), store, provider, 'any'))).toHaveLength(7)
    })
})
