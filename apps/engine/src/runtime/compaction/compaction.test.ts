import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { modelContextWindow } from '@rerun/contracts'
import { COMPACTION_MAX_TRIGGER_TOKENS, COMPACTION_TRIGGER_RATIO } from './config.js'
import { estimateTokens } from './estimate.js'
import { tailStartIndex } from './split.js'
import { pruneToolOutputs } from './prune.js'
import { repairToolPairs } from './repair.js'
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

    it('keeps the result handle as the pointer of a pruned result', () => {
        const saved = '.rerun/results/abc123.txt'
        const result = `${'z'.repeat(5000)}\nSaved whole: ${saved}, lines 1-120`
        const messages = [assistantCall('a'), toolResult('a', result), userText('recent')]

        const { messages: out } = pruneToolOutputs(messages, 2)

        expect((out[1].content as Array<{ output: { value: string } }>)[0].output.value).toContain(saved)
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

        expect(withoutReasoning(plain)).toBe(plain)
        expect(withoutReasoning(call)).toBe(call)
    })
})
