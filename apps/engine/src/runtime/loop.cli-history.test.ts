import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'
import type { Provider } from '@rerun/contracts'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-cli-history-'))

type PromptMessage = { role: string; content: Array<{ type: string; toolCallId?: string; providerExecuted?: boolean }> }

const { running, prompts } = vi.hoisted(() => ({
    running: { provider: 'anthropic' as string },
    prompts: [] as unknown[],
}))

vi.mock('./notify.js', async importOriginal => ({ ...(await importOriginal<typeof import('./notify.js')>()), sendNotification: async () => ({ delivered: true }) }))
vi.mock('../tools/registry.js', () => ({ buildTools: async () => ({ tools: {}, close: async () => {} }) }))
vi.mock('../connections/cli-auth.js', () => ({ ensureCliAuth: async () => () => {} }))
vi.mock('../connections/codex-auth.js', () => ({ syncCodexAuth: async () => {} }))
vi.mock('../connections/codex-plan-limits.js', () => ({ refreshCodexPlanLimits: async () => {} }))
vi.mock('../connections/claude-plan-limits.js', async importOriginal => ({ ...(await importOriginal<typeof import('../connections/claude-plan-limits.js')>()), refreshClaudePlanLimitsAfterRun: async () => {} }))
vi.mock('./curator.js', () => ({ runCurator: async () => {} }))
vi.mock('../agents/availability.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../agents/availability.js')>()),
    resolveRunModel: async () => ({ provider: running.provider, model: 'some-model', connection: { id: 'cnx', provider: running.provider, env: {}, config: {} } }),
}))

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...actual,
        resolveModel: () => ({
            model: new MockLanguageModelV3({
                doStream: async options => {
                    prompts.push(options.prompt)
                    return {
                        stream: new ReadableStream({
                            start(controller) {
                                controller.enqueue({ type: 'stream-start', warnings: [] })
                                controller.enqueue({ type: 'text-start', id: '0' })
                                controller.enqueue({ type: 'text-delta', id: '0', delta: 'ok' })
                                controller.enqueue({ type: 'text-end', id: '0' })
                                controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } })
                                controller.close()
                            },
                        }),
                    }
                },
            }),
            close: async () => {},
            quickReplies: () => undefined,
        }),
    }
})

const { beforeAll, beforeEach, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { appendMessage } = await import('../db/repos/messages.js')
const { runAgent } = await import('./loop.js')

const id = 'clihistoryagent'

async function promptAfterCodexTurn(provider: Provider): Promise<PromptMessage[]> {
    running.provider = provider
    const session = await createSession(id, 'search')
    await appendMessage(id, session.id, { role: 'user', content: 'search' })
    await appendMessage(id, session.id, {
        role: 'assistant',
        content: [
            { type: 'tool-call', toolCallId: 'exec-1', toolName: 'web_search', input: { type: 'webSearch', query: '' }, providerExecuted: true },
            { type: 'tool-result', toolCallId: 'exec-1', toolName: 'web_search', output: { type: 'json', value: { type: 'webSearch', query: 'bridge height' } } },
            { type: 'text', text: 'Found.' },
        ],
    })
    const run = await runAgent(await getAgent(id), session.id, 'and now?')
    expect(await run.settled).toEqual({ kind: 'done' })
    return (prompts[0] as PromptMessage[]).filter(message => message.role !== 'system')
}

describe('a turn of a CLI read again by another provider', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir(id), { recursive: true })
        await writeAgentConfig(id, agentConfigSchema.parse({ name: 'cli history', selfImprovement: { enabled: false } }))
    })

    beforeEach(() => {
        prompts.length = 0
    })

    // RER-270: Anthropic took the web_search of a Codex turn for its own and refused the whole history.
    it.each(['anthropic', 'openai', 'google', 'openrouter', 'custom'] as const)('is sent to %s with its results in tool messages', async provider => {
        const prompt = await promptAfterCodexTurn(provider)

        expect(prompt.map(message => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user'])
        expect(prompt[1].content[0]).toMatchObject({ type: 'tool-call', toolCallId: 'exec-1' })
        expect(prompt[1].content[0].providerExecuted).toBeUndefined()
        expect(prompt[2].content[0]).toMatchObject({ type: 'tool-result', toolCallId: 'exec-1' })
    })

    it.each(['codex', 'claude'] as const)('is sent to %s as it is stored', async provider => {
        const prompt = await promptAfterCodexTurn(provider)

        expect(prompt.map(message => message.role)).toEqual(['user', 'assistant', 'user'])
        expect(prompt[1].content.map(part => part.type)).toEqual(['tool-call', 'tool-result', 'text'])
    })
})
