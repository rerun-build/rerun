import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { agentConfigSchema, quickRepliesOf, quickReplyDraft, quickReplyPromisesValue } from '@rerun/contracts'
import { QuickRepliesSplitter, createQuickRepliesCapture, offersQuickReplies, parseQuickRepliesBlock, quickRepliesCall, withoutQuickRepliesCalls } from './quick-replies-stream.js'

const BLOCK = '<quick_replies>\nFind 100 more\nExport them as CSV\n</quick_replies>'

function split(deltas: string[], id = 't'): { text: string[]; blocks: string[][] } {
    const blocks: string[][] = []
    const splitter = new QuickRepliesSplitter(replies => blocks.push(replies))
    const text = deltas.flatMap(delta => splitter.delta(id, delta))
    text.push(...splitter.end(id))
    return { text, blocks }
}

describe('QuickRepliesSplitter', () => {
    it('cuts the block that closes the message and keeps the replies', () => {
        const { text, blocks } = split(['Here are your 100 leads.\n\n', BLOCK])
        expect(text.join('')).toBe('Here are your 100 leads.')
        expect(blocks).toEqual([['Find 100 more', 'Export them as CSV']])
    })

    it('releases the text as it comes, holding back only what could still open the tag', () => {
        const { text } = split(['Here are ', 'your leads.', ' Next <', 'b>bold</b> done.'])
        expect(text).toEqual(['Here are', ' your leads.', ' Next', ' <b>bold</b> done.'])
    })

    it('finds a tag split across deltas', () => {
        const { text, blocks } = split(['Done.\n<qui', 'ck_repl', 'ies>\nFind 100 more\n</quick_', 'replies>'])
        expect(text.join('')).toBe('Done.')
        expect(blocks).toEqual([['Find 100 more']])
    })

    it('takes a block the text ends on without its closing tag', () => {
        const { text, blocks } = split(['Done.\n<quick_replies>\nFind 100 more\nStop here'])
        expect(text.join('')).toBe('Done.')
        expect(blocks).toEqual([['Find 100 more', 'Stop here']])
    })

    it('swallows the code fence a model wraps the block in', () => {
        const { text, blocks } = split(['Done.\n\n```xml\n', BLOCK, '\n``', '`\n'])
        expect(text.join('')).toBe('Done.')
        expect(blocks).toEqual([['Find 100 more', 'Export them as CSV']])
    })

    it('lets a real code block through, fence included', () => {
        const { text } = split(['Run this:\n```', 'sh\nls -la\n```\nThen tell me.'])
        expect(text.join('')).toBe('Run this:\n```sh\nls -la\n```\nThen tell me.')
    })

    it('lets the text after a closed block flow again', () => {
        const { text, blocks } = split([`Done.\n${BLOCK}\n`, 'Anything else?'])
        expect(text.join('')).toBe('Done.Anything else?')
        expect(blocks).toHaveLength(1)
    })

    it('keeps the last block when the text holds two', () => {
        const { blocks } = split([`<quick_replies>\nFirst\n</quick_replies>\nThen.\n<quick_replies>\nSecond\n</quick_replies>`])
        expect(blocks).toEqual([['First'], ['Second']])
    })

    it('releases a held tail that never became the tag', () => {
        const { text } = split(['Less than <quick'])
        expect(text.join('')).toBe('Less than <quick')
    })

    it('keeps text blocks of different ids apart', () => {
        const splitter = new QuickRepliesSplitter(() => {})
        expect(splitter.delta('a', 'one <')).toEqual(['one'])
        expect(splitter.delta('b', 'two')).toEqual(['two'])
        expect(splitter.end('a')).toEqual([' <'])
        expect(splitter.end('b')).toEqual([])
    })
})

describe('parseQuickRepliesBlock', () => {
    it('reads one reply per line, without bullets or quotes, and drops duplicates', () => {
        expect(parseQuickRepliesBlock('- "Find 100 more"\n* Export them as CSV\n1. find 100 more\n\n')).toEqual(['Find 100 more', 'Export them as CSV'])
    })

    it('keeps the first three and leaves out a reply over the length limit', () => {
        expect(parseQuickRepliesBlock('a\nb\nc\nd')).toEqual(['a', 'b', 'c'])
        expect(parseQuickRepliesBlock(`${'x'.repeat(41)}\nShort one`)).toEqual(['Short one'])
    })

    it('reads nothing out of an empty block', () => {
        expect(parseQuickRepliesBlock('\n  \n')).toEqual([])
    })
})

describe('createQuickRepliesCapture', () => {
    const run = async (parts: unknown[]) => {
        const capture = createQuickRepliesCapture()
        const stream = new ReadableStream({
            start(controller) {
                for (const part of parts) controller.enqueue(part)
                controller.close()
            },
        })
        const wrapped = await capture.middleware.wrapStream!({ doStream: async () => ({ stream }) } as never)
        const seen: Array<Record<string, unknown>> = []
        for await (const part of wrapped.stream as unknown as AsyncIterable<Record<string, unknown>>) seen.push(part)
        return { seen, capture }
    }

    it('cuts the block out of the stream and reads the replies back under one call id', async () => {
        const { seen, capture } = await run([
            { type: 'reasoning-delta', id: 'r', delta: 'thinking <quick_replies>' },
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'Done.\n' },
            { type: 'text-delta', id: 't', delta: BLOCK },
            { type: 'text-end', id: 't' },
            { type: 'tool-call', toolCallId: 'c1', toolName: 'fs_read', input: '{}' },
            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' } },
        ])
        expect(seen.map(p => p.type)).toEqual(['reasoning-delta', 'text-start', 'text-delta', 'text-end', 'tool-call', 'finish'])
        expect(seen[2]).toEqual({ type: 'text-delta', id: 't', delta: 'Done.' })
        const first = capture.read()
        expect(first).toEqual({ toolCallId: expect.any(String), replies: ['Find 100 more', 'Export them as CSV'] })
        expect(capture.read()?.toolCallId).toBe(first?.toolCallId)
    })

    it('reads nothing when the text held no block, and flushes a held tail before the text ends', async () => {
        const { seen, capture } = await run([
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'a < b' },
            { type: 'text-delta', id: 't', delta: ' and ```' },
            { type: 'text-end', id: 't' },
        ])
        expect(seen).toEqual([
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'a < b' },
            { type: 'text-delta', id: 't', delta: ' and' },
            { type: 'text-delta', id: 't', delta: ' ```' },
            { type: 'text-end', id: 't' },
        ])
        expect(capture.read()).toBeUndefined()
    })

    it('cuts the block out of a one-shot answer too', async () => {
        const capture = createQuickRepliesCapture()
        const wrapped = await capture.middleware.wrapGenerate!({ doGenerate: async () => ({ content: [{ type: 'text', text: `Done.\n${BLOCK}` }, { type: 'text', text: 'Plain.' }] }) } as never)
        expect(wrapped.content).toEqual([
            { type: 'text', text: 'Done.' },
            { type: 'text', text: 'Plain.' },
        ])
        expect(capture.read()?.replies).toEqual(['Find 100 more', 'Export them as CSV'])
    })
})

describe('quickRepliesCall', () => {
    it('is the call the chat reads the replies from', () => {
        expect(quickRepliesCall({ toolCallId: 'q1', replies: ['Find 100 more'] })).toEqual({ toolCallId: 'q1', toolName: 'suggest_replies', input: { replies: ['Find 100 more'] } })
    })
})

describe('offersQuickReplies', () => {
    const config = (over: Record<string, unknown>) => agentConfigSchema.parse({ name: 'a', ...over })

    it('holds for a regular coworker and not for a sub-coworker, the foreman or a switched-off one', () => {
        expect(offersQuickReplies(config({}))).toBe(true)
        expect(offersQuickReplies(config({ ephemeral: true }))).toBe(false)
        expect(offersQuickReplies(config({ kind: 'foreman' }))).toBe(false)
        expect(offersQuickReplies(config({ tools: { quickReplies: false } }))).toBe(false)
    })
})

describe('withoutQuickRepliesCalls', () => {
    const call = (toolName: string) => ({ type: 'tool-call', toolCallId: 'c', toolName, input: {} })

    it('drops the old call, bare or bridged, and keeps the rest', () => {
        const message = { role: 'assistant', content: [{ type: 'text', text: 'Done.' }, call('suggest_replies'), call('mcp__rerun__suggest_replies'), call('fs_read')] } as unknown as ModelMessage
        expect(withoutQuickRepliesCalls(message)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Done.' }, call('fs_read')] })
    })

    it('drops a turn that held nothing else, and leaves an untouched message as is', () => {
        expect(withoutQuickRepliesCalls({ role: 'assistant', content: [call('suggest_replies')] } as unknown as ModelMessage)).toBeNull()
        const plain = { role: 'assistant', content: 'Done.' } as ModelMessage
        expect(withoutQuickRepliesCalls(plain)).toBe(plain)
        const parts = { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } as ModelMessage
        expect(withoutQuickRepliesCalls(parts)).toBe(parts)
    })
})

describe('quick reply that announces a value', () => {
    it('reaches the chat as a reply to finish in the composer, not one to send', () => {
        const { blocks } = split(['Please send the repository URL.\n\n', "<quick_replies>\nHere is the repo URL\nI'll upload a local clone\nUse the last release as the start\n</quick_replies>"])
        const call = quickRepliesCall({ toolCallId: 'qr-1', replies: blocks[0] })
        const chips = quickRepliesOf({ role: 'assistant', parts: [{ type: `tool-${call.toolName}`, toolCallId: call.toolCallId, state: 'input-available', input: call.input }] })
        expect(chips).toEqual(['Here is the repo URL', 'Use the last release as the start'])
        expect(chips.map(quickReplyDraft)).toEqual(['Here is the repo URL: ', null])
    })
})

describe('quickReplyPromisesValue', () => {
    it('spots a reply that only promises to send something later', () => {
        for (const reply of ["It's on GitHub, I'll send the URL", "I'll upload a local clone", 'I’ll paste it now', 'I will share access', "Je t'envoie l'URL", 'Je vais vous envoyer le lien', 'Je colle le lien', "I'll send you the link", "Je te donne l'accès"]) expect(quickReplyPromisesValue(reply)).toBe(true)
    })

    it('keeps a reply the user can send as is', () => {
        for (const reply of ['Since the last release', 'Send it to my inbox', 'Share it with my team', 'Last 20 merged PRs', "I'll do it myself", 'Envoie-le à mon équipe', "I'll send it myself", "I'll share it with the team myself", "I'll give it a try", 'Je donne mon accord', 'Je te donne le feu vert', "I'll add a chart"]) expect(quickReplyPromisesValue(reply)).toBe(false)
    })
})

describe('quickReplyDraft', () => {
    it('turns an announcement into the start of a message', () => {
        expect(quickReplyDraft('Here is the repo URL')).toBe('Here is the repo URL: ')
        expect(quickReplyDraft("Here's my email")).toBe("Here's my email: ")
        expect(quickReplyDraft('Here are the IDs')).toBe('Here are the IDs: ')
        expect(quickReplyDraft('Voici le lien')).toBe('Voici le lien: ')
    })

    it('takes a reply ending on a mark that waits for a value', () => {
        expect(quickReplyDraft('Here is the repo URL…')).toBe('Here is the repo URL: ')
        expect(quickReplyDraft('My company name is...')).toBe('My company name is: ')
        expect(quickReplyDraft('Le lien du dépôt :')).toBe('Le lien du dépôt: ')
    })

    it('leaves a reply that stands on its own to be sent', () => {
        for (const reply of ['Find 100 more', 'Export them as CSV', 'Use the last release as the start', "I'll upload a local clone", 'Thereafter weekly', '…', "Voilà, c'est fait", 'Here you go, all set!', 'Voici, c’est bon']) expect(quickReplyDraft(reply)).toBeNull()
    })
})
