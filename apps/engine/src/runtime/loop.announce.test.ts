import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-announce-'))

const { hooks } = vi.hoisted(() => ({
    hooks: { onStream: undefined as (() => void) | undefined },
}))

vi.mock('../tools/registry.js', () => ({
    buildTools: async () => ({ tools: {}, close: async () => {} }),
}))

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...actual,
        resolveModel: () => ({
            model: new MockLanguageModelV3({
                doStream: async () => {
                    hooks.onStream?.()
                    return {
                        stream: new ReadableStream({
                            start(controller) {
                                for (const part of [
                                    { type: 'stream-start', warnings: [] },
                                    { type: 'text-start', id: '0' },
                                    { type: 'text-delta', id: '0', delta: 'done' },
                                    { type: 'text-end', id: '0' },
                                    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
                                ]) controller.enqueue(part)
                                controller.close()
                            },
                        }),
                    }
                },
            }),
            close: async () => {},
        }),
    }
})

const { beforeAll, describe, expect, it } = await import('vitest')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { agentDir } = await import('../config/paths.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { runAgent } = await import('./loop.js')
const { announceToAgentRuns } = await import('./run-control.js')

const part = { type: 'data-mcp-reconnect', data: { name: 'x', effect: 'next_call' } } as const

describe('announcing to the runs of an agent', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir('announce'), { recursive: true })
        await writeAgentConfig('announce', agentConfigSchema.parse({ name: 'announce', provider: 'anthropic' }))
    })

    it("a part announced to the agent while its run is live reaches the run's writer", async () => {
        const written: unknown[] = []
        const writer = { write: (p: unknown) => void written.push(p), merge: () => {}, onError: undefined }
        const counts: number[] = []
        hooks.onStream = () => {
            counts.push(announceToAgentRuns('announce', part as never))
        }
        const session = await createSession('announce', 'go')
        const agent = await getAgent('announce')
        const started = await runAgent(agent, session.id, 'go', undefined, writer as never, undefined, { source: 'chat' })
        await started.settled
        hooks.onStream = undefined
        expect(counts).toEqual([1])
        expect(written).toContainEqual(part)
    })

    it('announcing after the run settled reaches nothing', async () => {
        const written: unknown[] = []
        const writer = { write: (p: unknown) => void written.push(p), merge: () => {}, onError: undefined }
        const session = await createSession('announce', 'go')
        const agent = await getAgent('announce')
        const started = await runAgent(agent, session.id, 'go', undefined, writer as never, undefined, { source: 'chat' })
        await started.settled
        expect(announceToAgentRuns('announce', part as never)).toBe(0)
    })
})
