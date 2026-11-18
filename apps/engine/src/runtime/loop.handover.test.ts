import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-loop-handover-'))

const seen = vi.hoisted(() => ({ options: undefined as { onCompact?: (event: unknown) => void; handover?: unknown } | undefined, save: vi.fn() }))

vi.mock('../tools/registry.js', () => ({
    buildTools: async () => ({ tools: {}, close: async () => {} }),
}))

vi.mock('../agents/handover.js', async importOriginal => ({
    ...(await importOriginal<typeof import('../agents/handover.js')>()),
    saveHandover: seen.save,
}))

vi.mock('../agents/providers.js', async importOriginal => {
    const actual = await importOriginal<typeof import('../agents/providers.js')>()
    const { MockLanguageModelV3 } = await import('ai/test')
    return {
        ...actual,
        resolveModel: (...args: unknown[]) => {
            seen.options = args[4] as typeof seen.options
            return {
                model: new MockLanguageModelV3({
                    doStream: async () => {
                        seen.options?.onCompact?.({ trigger: 'auto', summaryChars: 3, summary: 'abc', handoverN: 1 })
                        return {
                            stream: new ReadableStream({
                                start(controller) {
                                    for (const part of [
                                        { type: 'stream-start', warnings: [] },
                                        { type: 'text-start', id: '0' },
                                        { type: 'text-delta', id: '0', delta: 'ok' },
                                        { type: 'text-end', id: '0' },
                                        { type: 'finish', finishReason: { unified: 'stop' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
                                    ])
                                        controller.enqueue(part)
                                    controller.close()
                                },
                            }),
                        }
                    },
                }),
                close: async () => {},
            }
        },
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
const { getRun } = await import('../db/repos/runs.js')
const { runAgent } = await import('./loop.js')

async function run(id: string) {
    const session = await createSession(id, 'go')
    const agent = await getAgent(id)
    const started = await runAgent(agent, session.id, 'go', { provider: 'claude' }, undefined, undefined, { source: 'chat' })
    await started.settled
    return getRun(id, started.runId)
}

describe('run handover', () => {
    beforeAll(async () => {
        await migrate()
        for (const [id, contextSize] of [['hoplanner', 'large'], ['hobuilder', 'small']] as const) {
            await mkdir(agentDir(id), { recursive: true })
            await writeAgentConfig(id, agentConfigSchema.parse({ name: id, provider: 'claude', contextSize }))
        }
    })

    it('leaves the run done and its handover path unset when the note cannot be written', async () => {
        seen.save.mockRejectedValue(new Error('disk full'))
        const row = await run('hoplanner')
        await vi.waitFor(() => expect(seen.save).toHaveBeenCalledWith('hoplanner', row?.id, 1, 'abc'))
        expect(seen.options?.handover).toMatchObject({ agentName: 'hoplanner', runId: row?.id })
        expect(await getRun('hoplanner', row?.id ?? '')).toMatchObject({ status: 'done', handoverPath: null })
    })

    it('records the note path when the write works', async () => {
        seen.save.mockResolvedValue('/d/shared/handover/hoplanner/r-1.md')
        const row = await run('hoplanner')
        await vi.waitFor(async () => expect((await getRun('hoplanner', row?.id ?? ''))?.handoverPath).toBe('/d/shared/handover/hoplanner/r-1.md'))
    })

    it('asks for no handover on a small run', async () => {
        seen.save.mockClear()
        await run('hobuilder')
        expect(seen.options?.handover).toBeUndefined()
        expect(seen.save).not.toHaveBeenCalled()
    })
})
