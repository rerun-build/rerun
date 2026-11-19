import { describe, expect, it } from 'vitest'
import { ANTHROPIC_CACHE_CONTROL, withAnthropicCacheBreakpoints } from '@moldwright/contracts'
import { cacheBreakpointsFetch } from './openrouter-cache.js'

const sentBody = async (body: unknown) => {
    let sent: string | undefined
    const inner = async (_input: unknown, init?: RequestInit) => {
        sent = init?.body as string
        return new Response('{}')
    }
    await cacheBreakpointsFetch(inner as never)('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
    if (sent === undefined) return undefined
    try {
        return JSON.parse(sent) as Record<string, unknown>
    } catch {
        return sent
    }
}

const chat = {
    model: 'anthropic/claude-sonnet-5.5',
    messages: [
        { role: 'system', content: 'stable' },
        { role: 'system', content: 'volatile' },
        { role: 'user', content: 'hi' },
    ],
}

describe('withAnthropicCacheBreakpoints', () => {
    it('marks each system message for an hour and keeps the top-level marker for the tail', () => {
        const out = withAnthropicCacheBreakpoints(chat)
        expect(out.messages).toEqual([
            { role: 'system', content: [{ type: 'text', text: 'stable', cache_control: ANTHROPIC_CACHE_CONTROL }] },
            { role: 'system', content: [{ type: 'text', text: 'volatile', cache_control: ANTHROPIC_CACHE_CONTROL }] },
            { role: 'user', content: 'hi' },
        ])
        expect(out.cache_control).toEqual(ANTHROPIC_CACHE_CONTROL)
        expect(ANTHROPIC_CACHE_CONTROL).toEqual({ type: 'ephemeral', ttl: '1h' })
    })

    it('marks the last text block of a system message already sent as blocks, and does it once', () => {
        const once = withAnthropicCacheBreakpoints({
            messages: [
                {
                    role: 'system',
                    content: [
                        { type: 'text', text: 'a' },
                        { type: 'text', text: 'b' },
                    ],
                },
            ],
        })
        expect(once.messages).toEqual([
            {
                role: 'system',
                content: [
                    { type: 'text', text: 'a' },
                    { type: 'text', text: 'b', cache_control: ANTHROPIC_CACHE_CONTROL },
                ],
            },
        ])
        expect(withAnthropicCacheBreakpoints(once)).toEqual(once)
    })
})

describe('cacheBreakpointsFetch', () => {
    it('rewrites a request for an Anthropic model and pins the provider', async () => {
        const sent = await sentBody(chat)
        expect(sent?.messages).toEqual(withAnthropicCacheBreakpoints(chat).messages)
        expect(sent?.cache_control).toEqual(ANTHROPIC_CACHE_CONTROL)
        expect(sent?.provider).toEqual({ order: ['anthropic'] })
    })

    it('keeps a provider preference the body already carries', async () => {
        const sent = await sentBody({ ...chat, provider: { allow_fallbacks: false } })
        expect(sent?.provider).toEqual({ order: ['anthropic'], allow_fallbacks: false })
    })

    it('leaves every other model, and a body it cannot read, untouched', async () => {
        const openai = { ...chat, model: 'openai/gpt-6-sol' }
        expect(await sentBody(openai)).toEqual(openai)
        expect(await sentBody('not json')).toBe('not json')
    })
})
