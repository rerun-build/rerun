import { describe, expect, it } from 'vitest'
import { buildAttachmentsRef } from '@/lib/chat/attachments-marker'
import { buildInstallMessage } from '@/lib/chat/install-marker'
import { MAX_TOOL_OUTPUT_CHARS, type HistoryMessage, toApiMessages, transformEngineMessages } from '@/lib/chat/engine-history'
import { PEAK_COUNT } from '@/lib/voice/peaks'

function user(text: string): HistoryMessage {
    return { id: 'u1', role: 'user', parts: [{ type: 'text', text }] }
}

function toolCall(toolName: string, output: unknown): HistoryMessage {
    return { id: 'a1', role: 'assistant', parts: [{ type: `tool-${toolName}`, toolCallId: 'c1', toolName, state: 'output-available', input: {}, output }] }
}

describe('toApiMessages', () => {
    it('keeps a plain user message as is', () => {
        expect(toApiMessages([user('Hello')])).toEqual([{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }])
    })

    it('lifts the attachments marker into metadata', () => {
        const [message] = toApiMessages([user(`Look at these\n\n${buildAttachmentsRef(['chat-uploads/mtr4k52x-lBg1lF-hero.png', 'chat-uploads/report.pdf'])}`)])
        expect(message.parts).toEqual([{ type: 'text', text: 'Look at these' }])
        expect(message.metadata?.attachments).toEqual([
            { name: 'hero.png', path: 'chat-uploads/mtr4k52x-lBg1lF-hero.png', mediaType: 'image/png' },
            { name: 'report.pdf', path: 'chat-uploads/report.pdf', mediaType: 'application/pdf' },
        ])
    })

    it('sends files sent without a word with no text part', () => {
        const [message] = toApiMessages([user(buildAttachmentsRef(['chat-uploads/a.bin']))])
        expect(message.parts).toEqual([])
        expect(message.metadata?.attachments?.[0].mediaType).toBe('application/octet-stream')
    })

    it('lifts the voice marker into metadata', () => {
        const [message] = toApiMessages([user('Call them back\n\n<voice src="chat-uploads/v.m4a" ms="4200" peaks="">')])
        expect(message.parts).toEqual([])
        expect(message.metadata?.voice).toEqual({ transcript: 'Call them back', src: 'chat-uploads/v.m4a', durationMs: 4200, peaks: '' })
    })

    it('lifts a voice message and the files sent with it together', () => {
        const [message] = toApiMessages([user(`Read this brief\n\n<voice src="chat-uploads/v.m4a" ms="4200" peaks="">\n\n${buildAttachmentsRef(['chat-uploads/brief.pdf'])}`)])
        expect(message.parts).toEqual([])
        expect(message.metadata?.voice).toEqual({ transcript: 'Read this brief', src: 'chat-uploads/v.m4a', durationMs: 4200, peaks: '' })
        expect(message.metadata?.attachments).toEqual([{ name: 'brief.pdf', path: 'chat-uploads/brief.pdf', mediaType: 'application/pdf' }])
    })

    it('hands the app the bare guide of an install, and who it installs', () => {
        const [message] = toApiMessages([user(buildInstallMessage('## Connect Gmail', 'Closer'))])
        expect(message).toEqual({ id: 'u1', role: 'user', parts: [{ type: 'text', text: '## Connect Gmail' }], metadata: { install: { agentName: 'Closer' } } })
    })

    it('hands the app the bare prompt of a scheduled run, and which routine fired it', () => {
        const [message] = toApiMessages([user('<scheduled_run schedule="daily-digest" name="Daily digest">\nSend the digest.\n</scheduled_run>')])
        expect(message).toEqual({ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Send the digest.' }], metadata: { scheduledRun: { slug: 'daily-digest', name: 'Daily digest' } } })
    })

    it('hands the waveform over unchanged', () => {
        const peaks = 'a'.repeat(PEAK_COUNT / 2) + 'z'.repeat(PEAK_COUNT / 2)
        const [message] = toApiMessages([user(`Hi\n\n<voice src="chat-uploads/v.m4a" ms="4200" peaks="${peaks}">`)])
        expect(message.metadata?.voice?.peaks).toBe(peaks)
    })

    it('hands the app when each message was written', () => {
        const createdAt = '2026-10-26T09:41:00.000Z'
        const [question, answer] = toApiMessages([
            { ...user('Hello'), metadata: { createdAt, authorId: 'me' } },
            { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }], metadata: { createdAt } },
        ])
        expect(question.metadata).toEqual({ createdAt, authorId: 'me' })
        expect(answer.metadata).toEqual({ createdAt })
    })

    it('dates a scheduled run as well as its routine', () => {
        const createdAt = '2026-10-26T09:41:00.000Z'
        const [message] = toApiMessages([{ ...user('<scheduled_run schedule="daily-digest" name="Daily digest">\nSend the digest.\n</scheduled_run>'), metadata: { createdAt } }])
        expect(message.metadata).toEqual({ createdAt, scheduledRun: { slug: 'daily-digest', name: 'Daily digest' } })
    })

    it('replaces an oversized tool output with a preview', () => {
        const [message] = toApiMessages([toolCall('web_fetch', 'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 1))])
        expect(message.parts[0]).toMatchObject({ output: { truncated: true, preview: 'x'.repeat(MAX_TOOL_OUTPUT_CHARS) } })
    })

    it('keeps what a paid call billed when it trims its output, so the spend receipt still adds up', () => {
        const output = { status: 'found', billedMicros: 4_500, message: 'Found.', result: 'r'.repeat(MAX_TOOL_OUTPUT_CHARS) }
        const [message] = toApiMessages([toolCall('mcp__rerun__paid_data', output)])
        expect(message.parts[0]).toMatchObject({ output: { status: 'found', billedMicros: 4_500, truncated: true } })
    })

    it('keeps a small tool output whole', () => {
        const [message] = toApiMessages([toolCall('web_fetch', { ok: true })])
        expect(message.parts[0]).toMatchObject({ output: { ok: true } })
    })

    it('never trims a card, whatever its size', () => {
        const rows = 'r'.repeat(MAX_TOOL_OUTPUT_CHARS * 2)
        const [message] = toApiMessages([toolCall('mcp__rerun__card_table', { rows })])
        expect(message.parts[0]).toMatchObject({ output: { rows } })
    })
})

describe('a card and the message written after it', () => {
    const at = (n: number) => `2026-10-09T14:02:${String(n).padStart(2, '0')}Z`
    const assistant = (id: string, content: unknown[], n: number) => ({ id, sessionId: 's1', role: 'assistant' as const, contentJson: JSON.stringify(content), toolCallsJson: null, createdAt: at(n) })
    const toolRow = (id: string, toolCallId: string, n: number) => ({ id, sessionId: 's1', role: 'tool' as const, contentJson: JSON.stringify([{ type: 'tool-result', toolCallId, toolName: 'ask_user', output: { status: 'delivered' } }]), toolCallsJson: null, createdAt: at(n) })
    const askUser = (toolCallId: string) => ({ type: 'tool-call', toolCallId, toolName: 'ask_user', input: { questions: [{ question: 'Which product?' }] } })

    it('folds the message into the card message, after the call, as the live transcript holds it', () => {
        const messages = transformEngineMessages([assistant('a1', [askUser('c1')], 1), toolRow('t1', 'c1', 2), assistant('a2', [{ type: 'text', text: 'Here is why I ask.' }], 3)])
        expect(messages).toHaveLength(1)
        expect(messages[0].parts.map(p => p.type)).toEqual(['tool-ask_user', 'text'])
        expect(messages[0].parts[1]).toEqual({ type: 'text', text: 'Here is why I ask.' })
    })

    it('keeps the time of the card message once the follow-up is folded in', () => {
        const messages = transformEngineMessages([assistant('a1', [askUser('c1')], 1), toolRow('t1', 'c1', 2), assistant('a2', [{ type: 'text', text: 'Here is why I ask.' }], 3)])
        expect(messages[0].metadata?.createdAt).toBe(at(1))
    })

    // The reloaded transcript is what the iOS app reads: an older build has to see the v2 stamp
    // there too, or it would draw option objects it cannot read.
    it('stamps v2 on a reloaded ask_user whose options carry a description', () => {
        const questions = [{ question: 'Which format?', header: 'Format', options: [{ label: 'One-pager', description: 'A single page' }, 'Deck'] }]
        const call = { type: 'tool-call', toolCallId: 'c1', toolName: 'ask_user', input: { questions } }
        const messages = transformEngineMessages([assistant('a1', [call], 1)])
        expect(messages[0].parts[0]).toMatchObject({ type: 'tool-ask_user', state: 'input-available', input: { questions, v: 2 } })
    })

    it('leaves a card that came with its message as it is', () => {
        const messages = transformEngineMessages([assistant('a1', [{ type: 'text', text: 'Two things to confirm.' }, askUser('c1')], 1), toolRow('t1', 'c1', 2)])
        expect(messages).toHaveLength(1)
        expect(messages[0].parts.map(p => p.type)).toEqual(['text', 'tool-ask_user'])
    })

    // A CLI turn is one row: a tool call, the message, the replies, and whatever the model wrote
    // after them. Glued into one text put first, two blocks read as one and the tool call that
    // preceded the message dropped under it.
    it('keeps the blocks of a turn in the order they were streamed', () => {
        const listPages = { type: 'tool-call', toolCallId: 'c1', toolName: 'facebook_list_pages', input: {} }
        const replies = { type: 'tool-call', toolCallId: 'c2', toolName: 'mcp__rerun__suggest_replies', input: { replies: ['Post it'] } }
        const content = [listPages, { type: 'tool-result', toolCallId: 'c1', toolName: 'facebook_list_pages', output: { pages: ['Rerun AI'] } }, { type: 'text', text: 'Yes, I can see the Rerun AI page. What do you want to do with it?' }, replies, { type: 'tool-result', toolCallId: 'c2', toolName: 'mcp__rerun__suggest_replies', output: 'Shown as buttons.' }, { type: 'text', text: 'Yes, I have access to your Rerun AI page.' }]
        const [message] = transformEngineMessages([assistant('a1', content, 1)])
        expect(message.parts.map(p => p.type)).toEqual(['tool-facebook_list_pages', 'text', 'tool-mcp__rerun__suggest_replies', 'text'])
        expect(message.parts[1]).toEqual({ type: 'text', text: 'Yes, I can see the Rerun AI page. What do you want to do with it?' })
        expect(message.parts[3]).toEqual({ type: 'text', text: 'Yes, I have access to your Rerun AI page.' })
        expect(message.parts[0]).toMatchObject({ state: 'output-available', output: { pages: ['Rerun AI'] } })
    })

    it('reads a row stored as a plain string as one text block', () => {
        const [message] = transformEngineMessages([{ id: 'a1', sessionId: 's1', role: 'assistant', contentJson: JSON.stringify('Done.'), toolCallsJson: null, createdAt: at(1) }])
        expect(message.parts).toEqual([{ type: 'text', text: 'Done.' }])
    })

    it('adds the calls of a legacy toolCallsJson after the content, once each', () => {
        const read = { type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', input: {} }
        const row = { id: 'a1', sessionId: 's1', role: 'assistant' as const, contentJson: JSON.stringify([{ type: 'text', text: 'Reading.' }, read]), toolCallsJson: JSON.stringify([read, { toolCallId: 'c2', toolName: 'fs_write', args: '{"path":"a"}' }]), createdAt: at(1) }
        const [message] = transformEngineMessages([row])
        expect(message.parts.map(p => p.type)).toEqual(['text', 'tool-fs_read', 'tool-fs_write'])
        expect(message.parts[2]).toMatchObject({ input: { path: 'a' } })
    })

    // The engine cuts the replies out of the text and keeps them beside the row, as the call the
    // chat draws the buttons from.
    it('reads the replies the engine kept beside the row as the call the chat draws them from', () => {
        const row = { id: 'a1', sessionId: 's1', role: 'assistant' as const, contentJson: JSON.stringify([{ type: 'text', text: 'Here are your 100 leads.' }]), toolCallsJson: JSON.stringify([{ toolCallId: 'q1', toolName: 'suggest_replies', input: { replies: ['Find 100 more'] } }]), createdAt: at(1) }
        const [message] = transformEngineMessages([row])
        expect(message.parts).toEqual([
            { type: 'text', text: 'Here are your 100 leads.' },
            { type: 'tool-suggest_replies', toolCallId: 'q1', toolName: 'suggest_replies', state: 'input-available', input: { replies: ['Find 100 more'] } },
        ])
    })

    it('keeps the steps of a turn apart when no card is involved', () => {
        const read = { type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', input: {} }
        const messages = transformEngineMessages([assistant('a1', [read], 1), assistant('a2', [{ type: 'text', text: 'Done.' }], 2), assistant('a3', [{ type: 'text', text: 'One more thing.' }], 3)])
        expect(messages.map(m => m.id)).toEqual(['engine-a1', 'engine-a2', 'engine-a3'])
    })
})

describe('a user turn stored as parts', () => {
    const row = (content: unknown) => ({ id: 'm1', sessionId: 's1', role: 'user' as const, contentJson: JSON.stringify(content), toolCallsJson: null, createdAt: '2026-10-05T10:00:00Z' })
    const context = (text: string) => ({ type: 'text', text, providerOptions: { rerun: { context: true } } })

    // The engine stores the turn as it sent it to the model, the memories it recalled and the time
    // of the turn included: the chat shows the words typed and nothing else.
    it('shows the words typed and hides the context the engine appended', () => {
        const [message] = transformEngineMessages([row([{ type: 'text', text: 'Hello' }, context('<relevant_memories>\n- (fact) Works for Acme\n</relevant_memories>\n\n<now>\n2026-10-05T10:00:00Z\n</now>')])])
        expect(message.parts).toEqual([{ type: 'text', text: 'Hello' }])
    })

    it('still lifts the markers out of a turn that carries a context part', () => {
        const [message] = toApiMessages(transformEngineMessages([row([{ type: 'text', text: `Look\n\n${buildAttachmentsRef(['chat-uploads/a.pdf'])}` }, context('<now>\n2026-10-05T10:00:00Z\n</now>')])]))
        expect(message.parts).toEqual([{ type: 'text', text: 'Look' }])
        expect(message.metadata?.attachments).toEqual([{ name: 'a.pdf', path: 'chat-uploads/a.pdf', mediaType: 'application/pdf' }])
    })
})

describe('message author', () => {
    const row = (id: string, authorId?: string | null) => ({ id, sessionId: 's1', role: 'user' as const, contentJson: JSON.stringify('hello'), toolCallsJson: null, createdAt: '2026-10-05T10:00:00Z', authorId })

    it('carries who typed a message from the engine row to the transcript', () => {
        const [signed, unsigned, legacy] = transformEngineMessages([row('m1', 'u1'), row('m2', null), row('m3')])
        expect(signed.metadata?.authorId).toBe('u1')
        expect(unsigned.metadata).not.toHaveProperty('authorId')
        expect(legacy.metadata).not.toHaveProperty('authorId')
    })

    it('hands the author to the app, beside the attachments', () => {
        const signed: HistoryMessage = { ...user('Hello'), metadata: { authorId: 'u1' } }
        expect(toApiMessages([signed])[0].metadata).toEqual({ authorId: 'u1' })
        const withFile: HistoryMessage = { ...user(`Look\n\n${buildAttachmentsRef(['chat-uploads/a.pdf'])}`), metadata: { authorId: 'u1' } }
        expect(toApiMessages([withFile])[0].metadata).toMatchObject({ authorId: 'u1', attachments: [{ path: 'chat-uploads/a.pdf' }] })
    })
})

describe('message times', () => {
    it('dates every message with the time the engine wrote it', () => {
        const messages = transformEngineMessages([
            { id: 'u1', sessionId: 's1', role: 'user', contentJson: JSON.stringify('Hi'), toolCallsJson: null, createdAt: '2026-10-26T09:00:00Z', authorId: 'm1' },
            { id: 'a1', sessionId: 's1', role: 'assistant', contentJson: JSON.stringify('Hello.'), toolCallsJson: null, createdAt: '2026-10-26T09:00:04Z' },
        ])
        expect(messages.map(m => m.metadata)).toEqual([{ createdAt: '2026-10-26T09:00:00Z', authorId: 'm1' }, { createdAt: '2026-10-26T09:00:04Z' }])
    })

    it('hands the time to the app too', () => {
        const [message] = toApiMessages([{ ...user('Hi'), metadata: { createdAt: '2026-10-26T09:00:00Z' } }])
        expect(message).toEqual({ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }], metadata: { createdAt: '2026-10-26T09:00:00Z' } })
    })
})
