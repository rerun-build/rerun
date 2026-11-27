import { describe, expect, it } from 'vitest'
import { CardTagSplitter, createCardTagGuard, firstTextCut } from './card-tag-stream.js'

// The end of the SEO optimizer message of 28 October: the questions asked in prose, then the card
// written as an empty tag instead of the call.
const MESSAGE = "Le classement nominatif reste possible si tu le veux, mais c'est ta décision de fondateur, pas la mienne.\n\nDeux précisions avant de lancer la chaîne : ChatSEO n'est pas connecté."
const EMPTY_TAG = '<ask_user>\n</ask_user>'

// The Support coworker's message of 27 November (RER-404), shortened: the skill proposal written as
// a [Tool call: ...] line, the way the Claude CLI shows its earlier calls, then the rest of the reply.
const BEFORE_CALL = 'Compris, je le fais en règle permanente et je te propose de la garder dans le skill de validation des réponses support. À toi de l\'accepter ou non dans la ligne ci-dessous.'
const CALL_LINE = '[Tool call: mcp__rerun__skill_propose({"mode":"edit","slug":"validation-des-reponses-support","title":"Toujours rédiger les drafts de réponse","instruction":"Rédige toujours un brouillon (f(x) compris)."})]'
const AFTER_CALL = 'Voici comment je l\'appliquerai :\n- **Email :** brouillon créé dans Resend, tu relis et tu envoies.'
const WRITTEN_CALL = `${BEFORE_CALL}\n${CALL_LINE}\n\n${AFTER_CALL}`

function split(deltas: string[], id = 't'): { text: string[]; cuts: string[]; calls: string[] } {
    const cuts: string[] = []
    const calls: string[] = []
    const splitter = new CardTagSplitter(cut => (cut.kind === 'tag' ? cuts : calls).push(cut.name))
    const text = deltas.flatMap(delta => splitter.delta(id, delta))
    text.push(...splitter.end(id))
    return { text, cuts, calls }
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

describe('CardTagSplitter on a tool call written as text', () => {
    it('cuts the [Tool call: ...] line and lets the rest of the reply through', () => {
        const { text, calls } = split([WRITTEN_CALL])
        expect(text.join('')).toBe(`${BEFORE_CALL}\n\n${AFTER_CALL}`)
        expect(calls).toEqual(['skill_propose'])
    })

    it('finds the call split across deltas, the marker included', () => {
        const deltas = [`${BEFORE_CALL}\n[To`, 'ol ca', 'll: mcp__rerun__skill_', 'propose({"mode":"ed', 'it"})]\n\n', AFTER_CALL]
        const { text, calls } = split(deltas)
        expect(text.join('')).toBe(`${BEFORE_CALL}\n\n${AFTER_CALL}`)
        expect(calls).toEqual(['skill_propose'])
    })

    it('cuts a call that closes the message, and the line break before it', () => {
        const { text, calls } = split([`${BEFORE_CALL}\n`, '[Tool call: ask_user({"questions":[]})]'])
        expect(text.join('')).toBe(BEFORE_CALL)
        expect(calls).toEqual(['ask_user'])
    })

    it('cuts every line of a call whose input runs over several lines', () => {
        const { text, calls } = split([`${BEFORE_CALL}\n[Tool call: mcp__rerun__request_approval({\n  "approvals": [\n    {"action": "Send"}\n  ]\n})]\n${AFTER_CALL}`])
        expect(text.join('')).toBe(`${BEFORE_CALL}\n${AFTER_CALL}`)
        expect(calls).toEqual(['request_approval'])
    })

    it('keeps the words written after the call on its line', () => {
        const { text, calls } = split([`${BEFORE_CALL}\n${CALL_LINE} Je te laisse valider.\n\n${AFTER_CALL}`])
        expect(text.join('')).toBe(`${BEFORE_CALL}\nJe te laisse valider.\n\n${AFTER_CALL}`)
        expect(calls).toEqual(['skill_propose'])
    })

    it('keeps the words after the call when they come in the same deltas as it', () => {
        const deltas = [`${BEFORE_CALL}\n[Tool call: mcp__rerun__skill_`, 'propose({"mode":"edit"})] Je te', ' laisse valider.\n\n', AFTER_CALL]
        expect(split(deltas).text.join('')).toBe(`${BEFORE_CALL}\nJe te laisse valider.\n\n${AFTER_CALL}`)
    })

    it('cuts the period left after a call and lets the next paragraphs through', () => {
        const { text, calls } = split([`${BEFORE_CALL}\n${CALL_LINE}.\n\n${AFTER_CALL}`])
        expect(text.join('')).toBe(`${BEFORE_CALL}\n\n${AFTER_CALL}`)
        expect(calls).toEqual(['skill_propose'])
    })

    it('cuts a call written without an input', () => {
        const { text, calls } = split([`${BEFORE_CALL}\n[Tool call: mcp__rerun__skill_propose]\n\n${AFTER_CALL}`])
        expect(text.join('')).toBe(`${BEFORE_CALL}\n\n${AFTER_CALL}`)
        expect(calls).toEqual(['skill_propose'])
    })

    it('ends a call that never closes on the first blank line', () => {
        const { text, calls } = split([`${BEFORE_CALL}\n[Tool call: mcp__rerun__skill_propose({\n  "mode": "edit"\n\n${AFTER_CALL}`])
        expect(text.join('')).toBe(`${BEFORE_CALL}\n\n${AFTER_CALL}`)
        expect(calls).toEqual(['skill_propose'])
    })

    it('keeps the words after the closing line of a call over several lines, and a )] quoted in its input', () => {
        const { text } = split([`${BEFORE_CALL}\n[Tool call: x({\n  "note": "voir (annexe [2])]",\n  "b": 1\n})] Voilà.\n${AFTER_CALL}`])
        expect(text.join('')).toBe(`${BEFORE_CALL}\nVoilà.\n${AFTER_CALL}`)
    })

    it('keeps a call quoted in a sentence or inside a code fence', () => {
        const inline = 'A line like `[Tool call: ask_user({})]` in a message runs nothing.'
        const fenced = 'The history shows:\n```\n[Tool call: ask_user({})]\n```\nDone.'
        expect(split([inline])).toEqual({ text: [inline], cuts: [], calls: [] })
        expect(split([fenced]).text.join('')).toBe(fenced)
        expect(split([fenced]).calls).toEqual([])
    })

    it('releases a line that only looked like it could open a call', () => {
        const { text, calls } = split(['[', 'The docs](https://docs.rerun.build) are up to date.'])
        expect(text.join('')).toBe('[The docs](https://docs.rerun.build) are up to date.')
        expect(calls).toEqual([])
    })
})

describe('firstTextCut', () => {
    it('spots a card tag, bridged or not, and nothing else', () => {
        expect(firstTextCut(`${MESSAGE}\n\n${EMPTY_TAG}`)).toEqual({ kind: 'tag', name: 'ask_user' })
        expect(firstTextCut('<mcp__rerun__request_approval>')).toEqual({ kind: 'tag', name: 'request_approval' })
        expect(firstTextCut('Call ask_user now. <b>bold</b>')).toBeNull()
        expect(firstTextCut('')).toBeNull()
    })

    it('spots a tool call written as text', () => {
        expect(firstTextCut(WRITTEN_CALL)).toEqual({ kind: 'call', name: 'skill_propose' })
        expect(firstTextCut('[Tool call: mcp__rerun__skill_propose]')).toEqual({ kind: 'call', name: 'skill_propose' })
    })

    it('sees no card in a tag quoted as inline code or inside a code fence, like the stream', () => {
        expect(firstTextCut('Never write `<ask_user>` in a message.')).toBeNull()
        expect(firstTextCut('The format looks like this:\n```xml\n<ask_user>\n</ask_user>\n```\nDone.')).toBeNull()
        expect(firstTextCut('Never write `[Tool call: ask_user({})]` in a message.')).toBeNull()
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

    it('cuts a tool call written as text out of a stream', async () => {
        const seen = await run([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: WRITTEN_CALL }, { type: 'text-end', id: 't' }, { type: 'finish' }])
        const text = seen
            .filter(part => part.type === 'text-delta')
            .map(part => part.delta)
            .join('')
        expect(text).toBe(`${BEFORE_CALL}\n\n${AFTER_CALL}`)
    })

    it('returns a one-shot answer without a card tag as it was', async () => {
        const content = [{ type: 'text', text: 'Plain.\n' }]
        const wrapped = await createCardTagGuard('agent-1', 'rerun').wrapGenerate!({ doGenerate: async () => ({ content }) } as never)
        expect(wrapped.content).toEqual(content)
    })
})
