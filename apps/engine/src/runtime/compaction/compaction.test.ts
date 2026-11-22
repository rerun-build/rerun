import { describe, expect, it } from 'vitest'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type ModelMessage } from 'ai'
import { modelContextWindow } from '@rerun/contracts'
import { COMPACTION_MAX_TRIGGER_TOKENS, COMPACTION_TRIGGER_RATIO } from './config.js'
import { estimateTokens } from './estimate.js'
import { tailStartIndex } from './split.js'
import { pruneToolOutputs } from './prune.js'
import { repairToolPairs, withToolResultsInToolMessages } from './repair.js'
import { compactionThreshold, withoutReasoning } from './compact.js'

function assistantCall(id: string, name = 'shell_exec'): ModelMessage {
    return { role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName: name, input: { command: 'ls' } }] } as ModelMessage
}

function toolResult(id: string, value: unknown, name = 'shell_exec'): ModelMessage {
    return { role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: name, output: { type: 'json', value } }] } as ModelMessage
}

function userText(text: string): ModelMessage {
    return { role: 'user', content: text } as ModelMessage
}

describe('estimateTokens', () => {
    it('scales with content length', () => {
        const small = estimateTokens([userText('hi')])
        const big = estimateTokens([userText('x'.repeat(4000))])
        expect(big).toBeGreaterThan(small)
        expect(big).toBeGreaterThanOrEqual(1000)
    })

    it('counts the system prompt', () => {
        expect(estimateTokens([], 'x'.repeat(400))).toBe(100)
    })

    it('counts what the request carries besides the transcript, the tool schemas', () => {
        expect(estimateTokens([], 'x'.repeat(400), 800)).toBe(300)
    })
})

describe('compactionThreshold', () => {
    it('caps an API model well under its window, and leaves a CLI on the ratio of its plan window', () => {
        expect(compactionThreshold(922_000, 'rerun')).toBe(COMPACTION_MAX_TRIGGER_TOKENS)
        expect(compactionThreshold(1_000_000, 'anthropic')).toBe(COMPACTION_MAX_TRIGGER_TOKENS)
        expect(compactionThreshold(128_000, 'openai')).toBe(96_000)
        expect(compactionThreshold(272_000, 'codex')).toBe(204_000)
        expect(compactionThreshold(200_000, 'claude')).toBe(150_000)
    })
})

describe('tailStartIndex', () => {
    it('keeps the most recent messages within budget', () => {
        const messages = Array.from({ length: 10 }, (_, i) => userText('x'.repeat(400) + i))
        const start = tailStartIndex(messages, 250)
        expect(start).toBeGreaterThan(0)
        expect(start).toBeLessThan(messages.length)
    })

    it('returns 0 when everything fits in the budget', () => {
        const messages = [userText('a'), userText('b')]
        expect(tailStartIndex(messages, 1_000_000)).toBe(0)
    })
})

describe('pruneToolOutputs', () => {
    it('replaces large tool outputs before the tail and preserves the tail', () => {
        const big = 'y'.repeat(5000)
        const messages = [assistantCall('a'), toolResult('a', big), userText('recent')]
        const { messages: out, prunedCount } = pruneToolOutputs(messages, 2)
        expect(prunedCount).toBe(1)
        const pruned = (out[1].content as Array<{ output: { type: string; value: string } }>)[0]
        expect(pruned.output.type).toBe('text')
        expect(pruned.output.value).toContain('[pruned]')
        expect(out[2]).toEqual(messages[2])
    })

    it('keeps where a pruned paid answer is saved, whether the result came as JSON or as text', () => {
        const saved = '.rerun/paid-data/tiktok.video.detail-2026-10-15-call_1.json'
        const result = { saved, status: 'found', result: { output: { video: { desc: 'y'.repeat(5000) } } } }
        const messages = [assistantCall('a', 'paid_data'), toolResult('a', result, 'paid_data'), assistantCall('b', 'mcp__rerun__paid_data'), { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'b', toolName: 'mcp__rerun__paid_data', output: { type: 'text', value: JSON.stringify(result) } }] } as ModelMessage, userText('recent')]

        const { messages: out } = pruneToolOutputs(messages, 4)

        for (const index of [1, 3]) expect((out[index].content as Array<{ output: { value: string } }>)[0].output.value).toContain(`the whole answer is saved at ${saved}, read it with paid_data_read`)
    })

    it('keeps where a pruned page read is saved', () => {
        const saved = '.rerun/pages/acme.com/es.served.html'
        const result = `[200] https://acme.com/es\nSaved whole: ${saved} (read or grep it for anything this result leaves out)\n\n${'y'.repeat(5000)}`
        const messages = [assistantCall('a', 'web_fetch'), toolResult('a', result, 'web_fetch'), userText('recent')]

        const { messages: out } = pruneToolOutputs(messages, 2)

        expect((out[1].content as Array<{ output: { value: string } }>)[0].output.value).toContain(`the whole page is saved at ${saved}, read or grep it`)
    })

    it('keeps where a cut tool result is saved, not a path quoted in its head', () => {
        const saved = '.rerun/tool-results/gmail_fetch-2026-11-19-abc.txt'
        const quoted = 'The whole result of x is saved at .rerun/tool-results/x-2026-11-01-old.txt: read on'
        const result = `${quoted}${'y'.repeat(5000)}\n…\n[Cut at 40000 of 1048000 characters. The whole result of gmail_fetch is saved at ${saved}: read on with tool_result_read from offset 40000.]`
        const messages = [assistantCall('a', 'gmail_fetch'), toolResult('a', result, 'gmail_fetch'), userText('recent')]

        const { messages: out } = pruneToolOutputs(messages, 2)

        expect((out[1].content as Array<{ output: { value: string } }>)[0].output.value).toContain(`the whole result is saved at ${saved}, read it with tool_result_read`)
    })

    it('keeps where a page read back from a cut result is saved, and the tool that reads it', () => {
        const saved = '.rerun/tool-results/gmail_fetch-2026-11-19-abc.txt'
        const quoted = 'The whole result of x is saved at .rerun/tool-results/x-2026-11-01-old.txt: read on'
        const page = `${quoted}${'y'.repeat(5000)}\n[Characters 40000 to 78000 of 1048000 of the result saved at ${saved}: read on with tool_result_read from offset 78000.]`
        const messages = [assistantCall('a', 'tool_result_read'), toolResult('a', page, 'tool_result_read'), userText('recent')]

        const { messages: out } = pruneToolOutputs(messages, 2)

        const value = (out[1].content as Array<{ output: { value: string } }>)[0].output.value
        expect(value).toContain(`the whole result is saved at ${saved}, read it with tool_result_read`)
        expect(value).not.toContain('paid_data_read')
    })

    it('leaves small outputs untouched', () => {
        const messages = [assistantCall('a'), toolResult('a', 'ok'), userText('recent')]
        const { prunedCount } = pruneToolOutputs(messages, 3)
        expect(prunedCount).toBe(0)
    })

    it('does not prune tool outputs inside the tail', () => {
        const big = 'y'.repeat(5000)
        const messages = [assistantCall('a'), toolResult('a', big)]
        const { prunedCount } = pruneToolOutputs(messages, 0)
        expect(prunedCount).toBe(0)
    })
})

describe('repairToolPairs', () => {
    it('adds a stub result for a dangling tool call', () => {
        const out = repairToolPairs([assistantCall('a'), userText('hi')])
        expect(out).toHaveLength(3)
        expect(out[1].role).toBe('tool')
        const stub = (out[1].content as Array<{ toolCallId: string; output: { value: string } }>)[0]
        expect(stub.toolCallId).toBe('a')
        expect(out[2]).toEqual(userText('hi'))
    })

    it('drops an orphan tool result and the now-empty tool message', () => {
        const out = repairToolPairs([toolResult('z', 'orphan'), userText('hi')])
        expect(out).toHaveLength(1)
        expect(out[0]).toEqual(userText('hi'))
    })

    it('keeps an intact tool call/result pair unchanged', () => {
        const input = [assistantCall('b'), toolResult('b', 'ok')]
        const out = repairToolPairs(input)
        expect(out).toHaveLength(2)
        expect(out[0]).toEqual(input[0])
        expect(out[1]).toEqual(input[1])
    })
})

// A turn as a run on Claude Code stores it: the CLI ran the tool, so the call and its result are both
// provider-executed and both sit in the assistant message.
const CLAUDE_CODE_TURN: ModelMessage[] = [
    userText('What is in notes.txt?'),
    {
        role: 'assistant',
        content: [
            { type: 'tool-call', toolCallId: 'toolu_01QwE', toolName: 'mcp__rerun__read_file', input: { path: 'notes.txt' }, providerExecuted: true },
            { type: 'tool-result', toolCallId: 'toolu_01QwE', toolName: 'mcp__rerun__read_file', output: { type: 'text', value: 'hi' } },
            { type: 'text', text: 'notes.txt contains "hi".' },
        ],
    } as ModelMessage,
    userText('thanks'),
]

async function openAiChatBodyOf(messages: ModelMessage[]): Promise<{ messages: Array<{ role: string; content?: unknown; tool_calls?: Array<{ id: string }>; tool_call_id?: string }> }> {
    let body = ''
    const provider = createOpenAI({ apiKey: 'k', baseURL: 'https://api.mistral.ai/v1', fetch: async (_url, init) => {
        body = String(init?.body)
        return new Response(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }] }), { headers: { 'Content-Type': 'application/json' } })
    } })
    await generateText({ model: provider.chat('mistral-large-latest'), messages, maxRetries: 0 })
    return JSON.parse(body)
}

describe('withToolResultsInToolMessages', () => {
    it('answers every call of a Claude Code turn in the OpenAI chat format', async () => {
        const sent = await openAiChatBodyOf(repairToolPairs(withToolResultsInToolMessages(CLAUDE_CODE_TURN)))

        expect(sent.messages.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user'])
        expect(sent.messages[1].tool_calls?.map(call => call.id)).toEqual(['toolu_01QwE'])
        expect(sent.messages[2]).toMatchObject({ tool_call_id: 'toolu_01QwE', content: 'hi' })
        expect(sent.messages[3].content).toBe('notes.txt contains "hi".')
    })

    it('leaves a call without an answer when the turn is sent as it is stored', async () => {
        const sent = await openAiChatBodyOf(repairToolPairs(CLAUDE_CODE_TURN))

        expect(sent.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user'])
        expect(sent.messages[1].tool_calls).toHaveLength(1)
    })

    it('leaves the turns of a tool Rerun ran untouched', () => {
        const turn = [userText('ls'), assistantCall('c1'), toolResult('c1', 'a.txt')]
        expect(withToolResultsInToolMessages(turn)).toEqual(turn)
    })
})

describe('modelContextWindow', () => {
    it('serves the model API window when no provider is given', () => {
        expect(modelContextWindow('gpt-5.6-sol')).toBe(872_000)
    })

    it('caps a CLI provider to what its client actually allows', () => {
        expect(modelContextWindow('gpt-5.6-sol', 'codex')).toBe(272_000)
        expect(modelContextWindow('gpt-6-sol', 'codex')).toBe(272_000)
    })

    it('never raises a window above the model own limit', () => {
        expect(modelContextWindow('gpt-4o', 'codex')).toBe(128_000)
    })

    it('leaves non-CLI providers alone', () => {
        expect(modelContextWindow('gpt-5.6-sol', 'openai')).toBe(872_000)
    })

    it('caps claude to what a subscription serves, since the engine owns its compaction', () => {
        expect(modelContextWindow('claude-opus-5', 'claude')).toBe(200_000)
        expect(modelContextWindow('claude-opus-5', 'anthropic')).toBe(1_000_000)
        expect(modelContextWindow('claude-opus-5-5', 'claude')).toBe(200_000)
        expect(modelContextWindow('claude-opus-5-5', 'anthropic')).toBe(1_000_000)
    })

    it('keeps the 1M window on the claude ids that ask for it', () => {
        expect(modelContextWindow('claude-sonnet-5[1m]', 'claude')).toBe(1_000_000)
    })

    // The session that could no longer be answered: ~421k tokens on codex/gpt-5.6-sol. The old
    // 1_050_000 window put the trigger at 787_500 and compaction never ran.
    it('would have compacted the session that got stuck', () => {
        const window = modelContextWindow('gpt-5.6-sol', 'codex')!
        expect(421_000).toBeGreaterThan(window * COMPACTION_TRIGGER_RATIO)
    })
})

describe('withoutReasoning', () => {
    it('drops the thought and keeps everything the turn actually did', () => {
        const message = {
            role: 'assistant',
            content: [
                { type: 'reasoning', text: 'They probably mean the second invoice.', providerOptions: { anthropic: { signature: 'sig-1' } } },
                { type: 'text', text: 'Invoice #2 is overdue.' },
                { type: 'tool-call', toolCallId: 'c1', toolName: 'shell_exec', input: { command: 'ls' } },
            ],
        } as ModelMessage

        expect(withoutReasoning(message)).toEqual({
            role: 'assistant',
            content: [
                { type: 'text', text: 'Invoice #2 is overdue.' },
                { type: 'tool-call', toolCallId: 'c1', toolName: 'shell_exec', input: { command: 'ls' } },
            ],
        })
    })

    it('hands back the very same message when there is nothing to drop', () => {
        const plain = userText('hello')
        const call = assistantCall('c1')
        const referenced = { role: 'assistant', content: [{ type: 'text', text: 'Done.', providerOptions: { openai: { itemId: 'msg_1', phase: 'final_answer' } } }] } as ModelMessage

        expect(withoutReasoning(plain)).toBe(plain)
        expect(withoutReasoning(call)).toBe(call)
        expect(withoutReasoning(referenced)).toBe(referenced)
    })

    // RER-138: a step of an OpenAI reasoning model, as the box stored it. Replayed without its reasoning
    // item, the call still went out as a reference to its stored item, which OpenAI refuses on every
    // later message of the conversation: "Item 'fc_…' of type 'function_call' was provided without its
    // required 'reasoning' item: 'rs_…'".
    const REASONING_ID = 'rs_033c4a0c6a47b33a006afbf3fd0c0c87d29fd7d570d1efe98b'
    const CALL_ID = 'fc_033c4a0c6a47b33a006afbf402050887d289123a4d7a05bdf3'
    const reasonedStep = {
        role: 'assistant',
        content: [
            { type: 'reasoning', text: '', providerOptions: { openai: { itemId: REASONING_ID, reasoningEncryptedContent: 'gAAAAABq-encrypted' } } },
            { type: 'tool-call', toolCallId: 'call_1', toolName: 'brain_search', input: { query: 'invoices' }, providerOptions: { openai: { itemId: CALL_ID } } },
            { type: 'text', text: 'Found them.', providerOptions: { openai: { itemId: 'msg_1', phase: 'final_answer' } } },
        ],
    } as ModelMessage

    it('drops the OpenAI item ids of a step whose reasoning it drops, and keeps the rest', () => {
        expect(withoutReasoning(reasonedStep)).toEqual({
            role: 'assistant',
            content: [
                { type: 'tool-call', toolCallId: 'call_1', toolName: 'brain_search', input: { query: 'invoices' } },
                { type: 'text', text: 'Found them.', providerOptions: { openai: { phase: 'final_answer' } } },
            ],
        })
    })

    it('sends OpenAI the replayed call in full, never as a reference to an item that needs its reasoning', async () => {
        let body: { input: Array<{ type?: string; id?: string; call_id?: string }> } | null = null
        const openai = createOpenAI({
            apiKey: 'sk-test',
            fetch: async (_url, init) => {
                body = JSON.parse(String(init?.body))
                return new Response(JSON.stringify({ error: { message: 'captured' } }), { status: 400 })
            },
        })
        const history: ModelMessage[] = [
            userText('find the invoices'),
            reasonedStep,
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'brain_search', output: { type: 'text', value: '2 found' } }] } as ModelMessage,
            userText('and the overdue ones?'),
        ]

        await generateText({ model: openai('gpt-6-luna'), messages: history.map(withoutReasoning), maxRetries: 0 }).catch(() => undefined)

        const input = body!.input
        expect(input.some(item => item.type === 'item_reference')).toBe(false)
        expect(input).toContainEqual(expect.objectContaining({ type: 'function_call', call_id: 'call_1', name: 'brain_search' }))
    })
})
