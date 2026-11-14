import { describe, expect, it } from 'vitest'
import { FakeToolCallSplitter, createFakeToolCallGuard } from './fake-tool-call-stream.js'

const MESSAGE = "Il me manque le screen de trafic. L'article sera en anglais américain comme les précédents sur ton compte."

const FAKE_RESULT = `<function_results>
<result>
<name>mcp__rerun__ask_user</name>
<output>User answered:
Question: Quel est le nom exact du coworker ?
Answer: Skool Growth Partner

Question: Le screen du trafic : tu peux me l'envoyer maintenant ?
Answer: [SKIPPED]
</output>
</result>
</function_results>`

function split(deltas: string[], id = 't'): { text: string[]; cuts: number } {
    let cuts = 0
    const splitter = new FakeToolCallSplitter(() => cuts++)
    const text = deltas.flatMap(delta => splitter.delta(id, delta))
    text.push(...splitter.end(id))
    return { text, cuts }
}

describe('FakeToolCallSplitter', () => {
    it('cuts the fake ask_user result the model wrote after its message', () => {
        const { text, cuts } = split([`${MESSAGE}\n\n`, FAKE_RESULT])
        expect(text.join('')).toBe(MESSAGE)
        expect(cuts).toBe(1)
    })

    it('finds a marker split across deltas', () => {
        const { text, cuts } = split([`${MESSAGE}\n<func`, 'tion_res', 'ults>\n<result>'])
        expect(text.join('')).toBe(MESSAGE)
        expect(cuts).toBe(1)
    })

    it('cuts a fake call the same way', () => {
        const { text } = split(['Je te pose les questions.\n', '<function_calls>\n<invoke name="mcp__rerun__ask_user">\n</invoke>\n</function_calls>'])
        expect(text.join('')).toBe('Je te pose les questions.')
    })

    it('drops everything the model writes after the fake result', () => {
        const { text } = split([`${MESSAGE}\n${FAKE_RESULT}\n\nParfait, je pars sur Skool Growth Partner.`])
        expect(text.join('')).toBe(MESSAGE)
    })

    it('keeps a marker inside a code fence', () => {
        const fenced = 'The legacy format looks like this:\n```xml\n<function_results>\n</function_results>\n```\nDone.'
        const { text, cuts } = split([fenced])
        expect(text.join('')).toBe(fenced)
        expect(cuts).toBe(0)
    })

    it('keeps a marker that does not start the line', () => {
        const inline = 'The block `<function_results>` is gone.\nIt said <function_results> once.'
        const { text, cuts } = split([inline])
        expect(text.join('')).toBe(inline)
        expect(cuts).toBe(0)
    })

    it('releases plain text as it comes, holding back only a line start that could become a marker', () => {
        const { text } = split(['Here are ', 'your leads.\n<', 'b>bold</b> done.'])
        expect(text).toEqual(['Here are', ' your leads.', '\n<b>bold</b> done.'])
        expect(text.join('')).toBe('Here are your leads.\n<b>bold</b> done.')
    })

    it('silences the other text blocks of the same call once it cut', () => {
        let cuts = 0
        const splitter = new FakeToolCallSplitter(() => cuts++)
        expect(splitter.delta('a', `${MESSAGE}\n${FAKE_RESULT}`)).toEqual([MESSAGE])
        expect(splitter.end('a')).toEqual([])
        expect(splitter.delta('b', 'Answer noted.')).toEqual([])
        expect(splitter.end('b')).toEqual([])
        expect(cuts).toBe(1)
    })
})

describe('createFakeToolCallGuard', () => {
    async function run(parts: Array<Record<string, unknown>>) {
        const stream = new ReadableStream({
            start(controller) {
                for (const part of parts) controller.enqueue(part)
                controller.close()
            },
        })
        const wrapped = await createFakeToolCallGuard('agent-1').wrapStream!({ doStream: async () => ({ stream }) } as never)
        const seen: Array<Record<string, unknown>> = []
        for await (const part of wrapped.stream as unknown as AsyncIterable<Record<string, unknown>>) seen.push(part)
        return seen
    }

    it('cuts the text of a stream and lets a real tool call through', async () => {
        const toolCall = { type: 'tool-call', toolCallId: 'c1', toolName: 'mcp__rerun__ask_user', input: '{}' }
        const seen = await run([
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: `${MESSAGE}\n\n` },
            { type: 'text-delta', id: 't', delta: FAKE_RESULT },
            { type: 'text-end', id: 't' },
            toolCall,
            { type: 'finish' },
        ])
        const text = seen.filter(part => part.type === 'text-delta').map(part => part.delta).join('')
        expect(text).toBe(MESSAGE)
        expect(seen).toContainEqual(toolCall)
        expect(seen.at(-1)).toEqual({ type: 'finish' })
    })

    it('leaves a stream without a fake call untouched', async () => {
        const seen = await run([
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'Done.\n\n' },
            { type: 'text-end', id: 't' },
        ])
        expect(seen.filter(part => part.type === 'text-delta').map(part => part.delta).join('')).toBe('Done.\n\n')
    })

    it('cuts a one-shot answer and drops the text parts left empty', async () => {
        const wrapped = await createFakeToolCallGuard('agent-1').wrapGenerate!({ doGenerate: async () => ({ content: [{ type: 'text', text: `${MESSAGE}\n${FAKE_RESULT}` }, { type: 'text', text: 'Noted.' }] }) } as never)
        expect(wrapped.content).toEqual([{ type: 'text', text: MESSAGE }])
    })

    it('returns a one-shot answer without a fake call as it was', async () => {
        const content = [{ type: 'text', text: 'Plain.\n' }]
        const wrapped = await createFakeToolCallGuard('agent-1').wrapGenerate!({ doGenerate: async () => ({ content }) } as never)
        expect(wrapped.content).toEqual(content)
    })
})
