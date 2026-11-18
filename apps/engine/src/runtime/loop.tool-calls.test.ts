import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-tool-calls-'))

const { stream } = vi.hoisted(() => ({ stream: { parts: [] as unknown[] } }))

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
                doStream: async () => ({
                    stream: new ReadableStream({
                        start(controller) {
                            for (const part of stream.parts) controller.enqueue(part)
                            controller.close()
                        },
                    }),
                }),
            }),
            close: async () => {},
        }),
    }
})

const { afterAll, beforeAll, describe, expect, it } = await import('vitest')
const { rm } = await import('node:fs/promises')
const { mkdir } = await import('node:fs/promises')
const { migrate } = await import('../db/migrate.js')
const { agentConfigSchema } = await import('../agents/types.js')
const { writeAgentConfig } = await import('../agents/config-write.js')
const { writeAgentEnv } = await import('../agents/env.js')
const { agentDir, dataDir } = await import('../config/paths.js')
const { writeSharedEnv } = await import('../agents/shared-env.js')
const { getAgent } = await import('../agents/registry.js')
const { createSession } = await import('../db/repos/sessions.js')
const { listToolCalls } = await import('../db/repos/telemetry.js')
const { runAgent } = await import('./loop.js')

const SECRET = 'tok-0123456789abcdef'
const SHARED = 'ghp-shared-0123456789'
const call = (id: string, toolName: string): unknown => ({ type: 'tool-call', toolCallId: id, toolName, input: '{}', providerExecuted: true, dynamic: true })
const result = (id: string, toolName: string, value: unknown, isError = false): unknown => ({ type: 'tool-result', toolCallId: id, toolName, result: value, isError, providerExecuted: true, dynamic: true })

describe('tool calls recorded for a run', () => {
    beforeAll(async () => {
        await migrate()
        await mkdir(agentDir('recorder'), { recursive: true })
        await writeAgentConfig('recorder', agentConfigSchema.parse({ name: 'recorder', provider: 'claude' }))
        await writeAgentEnv('recorder', { API_TOKEN: SECRET })
        await writeSharedEnv({ GH_TOKEN: SHARED })
    })

    afterAll(async () => {
        await rm(resolve(dataDir(), 'shared.env'), { force: true })
    })

    it('keeps the error text of a failed call and marks a call the run cut', async () => {
        stream.parts = [
            { type: 'stream-start', warnings: [] },
            call('ok', 'mcp__rerun__fs_read'),
            result('ok', 'mcp__rerun__fs_read', 'file text'),
            call('blocks', 'mcp__rerun__fs_write'),
            result('blocks', 'mcp__rerun__fs_write', [{ type: 'text', text: `Path escapes the root: /data/work/wt/x key ${SECRET} gh ${SHARED}` }], true),
            call('plain', 'shell_exec'),
            result('plain', 'shell_exec', '<tool_use_error>Error: No such tool available: shell_exec</tool_use_error>', true),
            call('long', 'mcp__rerun__fs_edit'),
            result('long', 'mcp__rerun__fs_edit', 'x'.repeat(5000), true),
            call('cut', 'mcp__rerun__shell_exec'),
            { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        ]
        const session = await createSession('recorder', 'go')
        const started = await runAgent(await getAgent('recorder'), session.id, 'go', { provider: 'claude' }, undefined, undefined, { source: 'chat' })
        await started.settled
        const rows = Object.fromEntries((await listToolCalls('recorder', started.runId)).map(row => [row.toolCallId, row]))

        expect(rows.ok).toMatchObject({ isError: 0, resultJson: JSON.stringify('file text') })
        expect(rows.blocks?.isError).toBe(1)
        expect(JSON.parse(rows.blocks!.resultJson!)).toBe('Path escapes the root: /data/work/wt/x key [redacted] gh [redacted]')
        expect(rows.plain?.isError).toBe(1)
        expect(JSON.parse(rows.plain!.resultJson!)).toContain('No such tool available: shell_exec')
        expect(JSON.parse(rows.long!.resultJson!).length).toBeLessThanOrEqual(2000)
        expect(rows.cut).toMatchObject({ isError: 1, resultJson: JSON.stringify('no result: the run ended') })
    })
})
