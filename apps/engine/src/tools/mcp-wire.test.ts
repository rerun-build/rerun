import { describe, expect, it } from 'vitest'
import { MCP_CALL_TOOL, MCP_SEARCH_TOOL, mcpToolCatalog } from './mcp-search.js'
import { mcpCallTool, mcpWireMiddleware } from './mcp-wire.js'

const tool = (name: string) => ({ name, inputSchema: { type: 'object' as const } })
const wire = mcpWireMiddleware(mcpToolCatalog([{ name: 'linear', tools: [tool('list_issues'), tool('create_issue')] }]))

// What the loop receives of the parts a model streamed.
async function received(parts: unknown[]): Promise<unknown[]> {
    const doStream = async () => ({
        stream: new ReadableStream({
            start(controller) {
                for (const part of parts) controller.enqueue(part)
                controller.close()
            },
        }),
    })
    const { stream } = await (wire.wrapStream as unknown as (options: { doStream: typeof doStream }) => Promise<{ stream: ReadableStream<unknown> }>)({ doStream })
    const out: unknown[] = []
    for await (const part of stream as unknown as AsyncIterable<unknown>) out.push(part)
    return out
}

// What the model is sent of a conversation.
async function sent(prompt: unknown[]): Promise<unknown[]> {
    const transform = wire.transformParams as unknown as (options: { params: { prompt: unknown[] } }) => Promise<{ prompt: unknown[] }>
    return (await transform({ params: { prompt } })).prompt
}

const call = (input: unknown, toolName = MCP_CALL_TOOL) => ({ type: 'tool-call', toolCallId: 'c1', toolName, input: typeof input === 'string' ? input : JSON.stringify(input) })

describe('mcpWireMiddleware, from the model', () => {
    it('hands a call to the tool it names, with its arguments as the input', async () => {
        expect(await received([call({ tool: 'linear_list_issues', arguments: { teamId: 'abc' } })])).toEqual([{ type: 'tool-call', toolCallId: 'c1', toolName: 'linear_list_issues', input: '{"teamId":"abc"}' }])
    })

    it.each([
        ['the name a CLI gives the tool', { tool: 'mcp__linear__create_issue', arguments: { title: 'Bug' } }],
        ['arguments written as JSON text', { tool: 'linear_create_issue', arguments: '{"title":"Bug"}' }],
        ['arguments laid beside the name', { tool: 'linear_create_issue', title: 'Bug' }],
        ['a name with spaces around it', { tool: ' linear_create_issue ', arguments: { title: 'Bug' } }],
    ])('takes %s', async (_, input) => {
        expect(await received([call(input)])).toEqual([{ type: 'tool-call', toolCallId: 'c1', toolName: 'linear_create_issue', input: '{"title":"Bug"}' }])
    })

    it('runs a tool that takes nothing with no argument', async () => {
        expect(await received([call({ tool: 'linear_list_issues' })])).toEqual([{ type: 'tool-call', toolCallId: 'c1', toolName: 'linear_list_issues', input: '{}' }])
    })

    it.each([
        ['a tool the agent does not hold back', call({ tool: 'fs_read', arguments: { path: 'a' } })],
        ['a name every object carries', call({ tool: 'constructor', arguments: {} })],
        ['no name', call({ arguments: { teamId: 'abc' } })],
        ['an input that is not JSON', call('{"tool": "linear_list_iss')],
        ['another tool', call({ query: 'issue' }, MCP_SEARCH_TOOL)],
    ])('leaves a call alone when it carries %s', async (_, part) => {
        expect(await received([part])).toEqual([part])
    })

    it('does not stream the input of a call whose tool is only known at its end', async () => {
        const other = [
            { type: 'tool-input-start', id: 'c2', toolName: 'fs_read' },
            { type: 'tool-input-delta', id: 'c2', delta: '{"path":"a"}' },
            { type: 'tool-input-end', id: 'c2' },
        ]
        const text = { type: 'text-delta', id: '0', delta: 'Reading.' }
        const parts = [text, { type: 'tool-input-start', id: 'c1', toolName: MCP_CALL_TOOL }, { type: 'tool-input-delta', id: 'c1', delta: '{"tool":' }, ...other, { type: 'tool-input-end', id: 'c1' }, call({ tool: 'linear_list_issues', arguments: {} })]
        expect(await received(parts)).toEqual([text, ...other, { type: 'tool-call', toolCallId: 'c1', toolName: 'linear_list_issues', input: '{}' }])
    })
})

describe('mcpWireMiddleware, to the model', () => {
    const output = { type: 'text', value: '[]' }
    const conversation = [
        { role: 'system', content: 'You are a coworker.' },
        { role: 'user', content: [{ type: 'text', text: 'any new issue?' }] },
        {
            role: 'assistant',
            content: [
                { type: 'text', text: 'Reading the issues.' },
                { type: 'tool-call', toolCallId: 'c1', toolName: 'linear_list_issues', input: { teamId: 'abc' } },
                { type: 'tool-call', toolCallId: 'c2', toolName: 'fs_read', input: { path: 'a' } },
            ],
        },
        {
            role: 'tool',
            content: [
                { type: 'tool-result', toolCallId: 'c1', toolName: 'linear_list_issues', output },
                { type: 'tool-result', toolCallId: 'c2', toolName: 'fs_read', output },
            ],
        },
    ]

    it('shows the calls of held-back tools as the call the model made, and leaves the rest', async () => {
        expect(await sent(conversation)).toEqual([
            conversation[0],
            conversation[1],
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Reading the issues.' },
                    { type: 'tool-call', toolCallId: 'c1', toolName: MCP_CALL_TOOL, input: { tool: 'linear_list_issues', arguments: { teamId: 'abc' } } },
                    { type: 'tool-call', toolCallId: 'c2', toolName: 'fs_read', input: { path: 'a' } },
                ],
            },
            {
                role: 'tool',
                content: [
                    { type: 'tool-result', toolCallId: 'c1', toolName: MCP_CALL_TOOL, output },
                    { type: 'tool-result', toolCallId: 'c2', toolName: 'fs_read', output },
                ],
            },
        ])
    })

    it('writes a conversation the same way every time, so its start stays in the provider cache', async () => {
        expect(JSON.stringify(await sent(conversation))).toBe(JSON.stringify(await sent(conversation)))
    })

    it('gives a call back to the model the way it wrote it', async () => {
        const made = { tool: 'linear_list_issues', arguments: { teamId: 'abc' } }
        const [ran] = (await received([call(made)])) as Array<{ toolCallId: string; toolName: string; input: string }>
        const [message] = (await sent([{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: ran.toolCallId, toolName: ran.toolName, input: JSON.parse(ran.input) }] }])) as Array<{ content: Array<{ toolName: string; input: unknown }> }>
        expect(message.content[0]).toMatchObject({ toolName: MCP_CALL_TOOL, input: made })
    })
})

describe('mcp_call', () => {
    it('says the tool does not exist when a call reaches it, and points to the search', async () => {
        const fallback = mcpCallTool()[MCP_CALL_TOOL] as unknown as { execute: (input: Record<string, unknown>, options: unknown) => Promise<{ error: string }> }
        const { error } = await fallback.execute({ tool: 'linear_delete_everything' }, { toolCallId: 'c', messages: [] })
        expect(error).toContain('No tool of your MCP servers is named "linear_delete_everything"')
        expect(error).toContain(MCP_SEARCH_TOOL)
    })
})
