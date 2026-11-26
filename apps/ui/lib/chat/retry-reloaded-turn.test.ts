import { Chat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { turnOpenerId } from '@rerun/contracts'

import { lastUserText } from '@/lib/chat-payload'
import { transformEngineMessages } from '@/lib/chat/engine-history'
import type { EngineMessage } from '@/lib/engine/types'

const USER_TEXT = 'Install Ubersuggest too'

// What the engine keeps of a run refused at its fifth step: the user message, then one assistant row
// and its tool row for each of the four steps that went through.
function failedRunTranscript(): EngineMessage[] {
    const rows = [{ id: 'u1', role: 'user', contentJson: JSON.stringify([{ type: 'text', text: USER_TEXT }]), createdAt: '2026-11-20T15:39:23.631Z' }]
    for (let step = 1; step <= 4; step++) {
        const toolCallId = `call-${step}`
        rows.push({ id: `a${step}`, role: 'assistant', contentJson: JSON.stringify([{ type: 'text', text: `Step ${step}` }, { type: 'tool-call', toolCallId, toolName: 'web_search', input: { query: 'ubersuggest' } }]), createdAt: '2026-11-20T15:40:52.602Z' })
        rows.push({ id: `t${step}`, role: 'tool', contentJson: JSON.stringify([{ type: 'tool-result', toolCallId, toolName: 'web_search', output: { type: 'text', value: 'ok' } }]), createdAt: '2026-11-20T15:40:52.622Z' })
    }
    return rows as EngineMessage[]
}

const ANSWER_STREAM = 'data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n'

// The hub: a stream for a message with a text, the 400 of /api/chat for one without.
function chatAgainstHub() {
    const sent: string[] = []
    const fetch = (async (_url: string, init: RequestInit) => {
        const { text } = JSON.parse(String(init.body)) as { text: string }
        sent.push(text)
        return text ? new Response(ANSWER_STREAM, { headers: { 'content-type': 'text/event-stream' } }) : Response.json({ error: 'Missing message text' }, { status: 400 })
    }) as unknown as typeof globalThis.fetch
    const chat = new Chat<UIMessage>({
        transport: new DefaultChatTransport({ api: '/api/chat', fetch, prepareSendMessagesRequest: ({ messages }) => ({ body: { text: lastUserText(messages) } }) }),
    })
    chat.messages = transformEngineMessages(failedRunTranscript()) as UIMessage[]
    return { chat, sent }
}

describe('Retry of a failed run read back from the engine', () => {
    it('reads the turn back as one assistant message per step', () => {
        expect(transformEngineMessages(failedRunTranscript()).map(message => message.role)).toEqual(['user', 'assistant', 'assistant', 'assistant', 'assistant'])
    })

    it('sends an empty text when regenerating the last message, as Retry did', async () => {
        const { chat, sent } = chatAgainstHub()
        await chat.regenerate()
        expect(sent).toEqual([''])
        expect(chat.error?.message).toContain('Missing message text')
    })

    it('sends the user message again on the first Retry from the turn opener', async () => {
        const { chat, sent } = chatAgainstHub()
        await chat.regenerate({ messageId: turnOpenerId(chat.messages) })
        expect(sent).toEqual([USER_TEXT])
        expect(chat.error).toBeUndefined()
        expect(chat.messages.filter(message => message.id.startsWith('engine-')).map(message => message.id)).toEqual(['engine-u1'])
    })

    it('regenerates the whole turn from a step in the middle of it', async () => {
        const { chat, sent } = chatAgainstHub()
        await chat.regenerate({ messageId: turnOpenerId(chat.messages, 'engine-a3') })
        expect(sent).toEqual([USER_TEXT])
    })
})

describe('turnOpenerId', () => {
    const turn = (n: number) => [
        { id: `u${n}`, role: 'user' },
        { id: `u${n}-step1`, role: 'assistant' },
        { id: `u${n}-step2`, role: 'assistant' },
        { id: `u${n}-step3`, role: 'assistant' },
    ]

    it('opens the last turn on the user message, past every step read back from the engine', () => {
        expect(turnOpenerId([...turn(1), ...turn(2)])).toBe('u2')
    })

    it('finds the turn of a step in the middle of it', () => {
        expect(turnOpenerId([...turn(1), ...turn(2)], 'u2-step2')).toBe('u2')
    })

    it('finds the turn of an older step', () => {
        expect(turnOpenerId([...turn(1), ...turn(2)], 'u1-step3')).toBe('u1')
    })

    it('keeps a user message as its own opener', () => {
        expect(turnOpenerId(turn(1), 'u1')).toBe('u1')
    })

    it('has nothing to open on without a user message or an unknown id', () => {
        expect(turnOpenerId([{ id: 'a1', role: 'assistant' }])).toBeUndefined()
        expect(turnOpenerId(turn(1), 'gone')).toBeUndefined()
        expect(turnOpenerId([])).toBeUndefined()
    })
})
