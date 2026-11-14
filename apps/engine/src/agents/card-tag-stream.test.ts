import { describe, expect, it } from 'vitest'
import { CardTagSplitter, createCardTagGuard, cutsCardTag } from './card-tag-stream.js'

const MESSAGE = "Le classement nominatif reste possible si tu le veux, mais c'est ta décision de fondateur, pas la mienne.\n\nDeux précisions avant de lancer la chaîne : ChatSEO n'est pas connecté."
const EMPTY_TAG = '<ask_user>\n</ask_user>'

function split(deltas: string[], id = 't'): { text: string[]; cuts: string[] } {
    const cuts: string[] = []
    const splitter = new CardTagSplitter(tag => cuts.push(tag))
    const text = deltas.flatMap(delta => splitter.delta(id, delta))
    text.push(...splitter.end(id))
    return { text, cuts }
}

describe('CardTagSplitter', () => {
    it('cuts the empty ask_user tag the model closed its message with, and the blank lines before it', () => {
        const { text, cuts } = split([`${MESSAGE}\n\n`, EMPTY_TAG])
        expect(text.join('')).toBe(MESSAGE)
        expect(cuts).toEqual(['ask_user', 'ask_user'])
    })

    it('finds a tag split across deltas', () => {
        const { text, cuts } = split([`${MESSAGE}\n\n<ask_`, 'us', 'er>\n</ask_', 'user>'])
        expect(text.join('')).toBe(MESSAGE)
        expect(cuts).toEqual(['ask_user', 'ask_user'])
    })

    it('keeps the question written between the tags', () => {
        const { text } = split([`${MESSAGE}\n\n<ask_user>\nQuel angle veux-tu ?\n</ask_user>\n`])
        expect(text.join('')).toBe(`${MESSAGE}\n\nQuel angle veux-tu ?`)
    })

    it('strips a tag written inline, keeping the rest of the line', () => {
        const { text } = split(['Dis-moi : <ask_user>Quel angle ?</ask_user> Merci.'])
        expect(text.join('')).toBe('Dis-moi : Quel angle ? Merci.')
    })

    it('cuts every card tool, bridged names and attributes included', () => {
        const { text, cuts } = split(['Done.\n<request_approval>\n</request_approval>\n<mcp__rerun__suggest_service slug="stripe" />\n<rerun__request_secret>\n'])
        expect(text.join('')).toBe('Done.')
        expect(cuts).toEqual(['request_approval', 'request_approval', 'suggest_service', 'request_secret'])
    })

    it('lets the text after a cut flow again', () => {
        const { text } = split([`Done.\n${EMPTY_TAG}\n`, 'Anything else?'])
        expect(text.join('')).toBe('Done.\nAnything else?')
    })

    it('keeps a tag inside a code fence', () => {
        const fenced = 'The format looks like this:\n```xml\n<ask_user>\n</ask_user>\n```\nDone.'
        const { text, cuts } = split([fenced])
        expect(text.join('')).toBe(fenced)
        expect(cuts).toEqual([])
    })

    it('keeps a tag quoted as inline code', () => {
        const inline = 'Never write `<ask_user>` in a message.'
        const { text, cuts } = split([inline])
        expect(text.join('')).toBe(inline)
        expect(cuts).toEqual([])
    })

    it('releases plain text as it comes, holding back only a `<` that could still open a card tag', () => {
        const { text } = split(['Here are ', 'your leads: a <', 'b>bold</b> one, and 1 <', 'ask_', 'user> gone.'])
        expect(text).toEqual(['Here are', ' your leads: a', ' <b>bold</b> one, and 1', '  gone.'])
    })

    it('keeps the trailing whitespace of a message that held no tag', () => {
        const { text } = split(['Done.\n\n'])
        expect(text.join('')).toBe('Done.\n\n')
    })

    it('keeps a plain tag that is not a card', () => {
        const { text, cuts } = split(['<thinking>no</thinking> and <asking>no</asking>'])
        expect(text.join('')).toBe('<thinking>no</thinking> and <asking>no</asking>')
        expect(cuts).toEqual([])
    })
})

describe('cutsCardTag', () => {
    it('spots a card tag, bridged or not, and nothing else', () => {
        expect(cutsCardTag(`${MESSAGE}\n\n${EMPTY_TAG}`)).toBe(true)
        expect(cutsCardTag('<mcp__rerun__request_approval>')).toBe(true)
        expect(cutsCardTag('Call ask_user now. <b>bold</b>')).toBe(false)
        expect(cutsCardTag('')).toBe(false)
    })

    it('sees no card in a tag quoted as inline code or inside a code fence, like the stream', () => {
        expect(cutsCardTag('Never write `<ask_user>` in a message.')).toBe(false)
        expect(cutsCardTag('The format looks like this:\n```xml\n<ask_user>\n</ask_user>\n```\nDone.')).toBe(false)
    })
})

describe('createCardTagGuard', () => {
    async function run(parts: Array<Record<string, unknown>>) {
        const stream = new ReadableStream({
            start(controller) {
                for (const part of parts) controller.enqueue(part)
                controller.close()
            },
        })
        const wrapped = await createCardTagGuard('agent-1', 'claude').wrapStream!({ doStream: async () => ({ stream }) } as never)
        const seen: Array<Record<string, unknown>> = []
        for await (const part of wrapped.stream as unknown as AsyncIterable<Record<string, unknown>>) seen.push(part)
        return seen
    }

    it('cuts the tag out of a stream and lets a real tool call through', async () => {
        const toolCall = { type: 'tool-call', toolCallId: 'c1', toolName: 'mcp__rerun__ask_user', input: '{}' }
        const seen = await run([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: `${MESSAGE}\n\n` }, { type: 'text-delta', id: 't', delta: EMPTY_TAG }, { type: 'text-end', id: 't' }, toolCall, { type: 'finish' }])
        const text = seen
            .filter(part => part.type === 'text-delta')
            .map(part => part.delta)
            .join('')
        expect(text).toBe(MESSAGE)
        expect(seen).toContainEqual(toolCall)
        expect(seen.at(-1)).toEqual({ type: 'finish' })
    })

    it('leaves a stream without a card tag untouched', async () => {
        const seen = await run([
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'Done.\n\n' },
            { type: 'text-end', id: 't' },
        ])
        expect(
            seen
                .filter(part => part.type === 'text-delta')
                .map(part => part.delta)
                .join('')
        ).toBe('Done.\n\n')
    })

    it('cleans a one-shot answer and drops a text part left empty', async () => {
        const wrapped = await createCardTagGuard('agent-1', 'rerun').wrapGenerate!({
            doGenerate: async () => ({
                content: [
                    { type: 'text', text: `${MESSAGE}\n\n${EMPTY_TAG}` },
                    { type: 'text', text: EMPTY_TAG },
                ],
            }),
        } as never)
        expect(wrapped.content).toEqual([{ type: 'text', text: MESSAGE }])
    })

    it('returns a one-shot answer without a card tag as it was', async () => {
        const content = [{ type: 'text', text: 'Plain.\n' }]
        const wrapped = await createCardTagGuard('agent-1', 'rerun').wrapGenerate!({ doGenerate: async () => ({ content }) } as never)
        expect(wrapped.content).toEqual(content)
    })
})
