import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Query } from 'ai-sdk-provider-claude-code'
import { claudeContextCapture } from './claude-context.js'
import { forgetPlanLimits, readPlanLimits } from '../connections/plan-limits.js'

function fakeQuery(getContextUsage: () => Promise<unknown>): Query {
    return { getContextUsage } as unknown as Query
}

function stopHookOf(capture: ReturnType<typeof claudeContextCapture>): () => Promise<unknown> {
    const matchers = capture.settings.hooks?.Stop ?? []
    return matchers[0]!.hooks[0]! as () => Promise<unknown>
}

describe('claudeContextCapture', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('snapshots the occupancy reported by getContextUsage on Stop', async () => {
        const capture = claudeContextCapture()
        capture.settings.onQueryCreated?.(fakeQuery(async () => ({ totalTokens: 120_000, maxTokens: 200_000 })))
        await expect(stopHookOf(capture)()).resolves.toEqual({ continue: true })
        expect(capture.read()).toEqual({ usedTokens: 120_000, maxTokens: 200_000 })
    })

    it('keeps the run alive and the snapshot empty when getContextUsage rejects', async () => {
        const capture = claudeContextCapture()
        capture.settings.onQueryCreated?.(fakeQuery(async () => Promise.reject(new Error('ProcessTransport is not ready for writing'))))
        await expect(stopHookOf(capture)()).resolves.toEqual({ continue: true })
        expect(capture.read()).toBeUndefined()
    })

    it('stays empty when Stop fires before any query was created', async () => {
        const capture = claudeContextCapture()
        await expect(stopHookOf(capture)()).resolves.toEqual({ continue: true })
        expect(capture.read()).toBeUndefined()
    })

    it('keeps the latest value across successive Stop hooks', async () => {
        const capture = claudeContextCapture()
        const stop = stopHookOf(capture)
        capture.settings.onQueryCreated?.(fakeQuery(async () => ({ totalTokens: 50_000, maxTokens: 200_000 })))
        await stop()
        capture.settings.onQueryCreated?.(fakeQuery(async () => ({ totalTokens: 90_000, maxTokens: 200_000 })))
        await stop()
        expect(capture.read()).toEqual({ usedTokens: 90_000, maxTokens: 200_000 })
    })

    it('rejects snapshots without a positive maxTokens', async () => {
        const capture = claudeContextCapture()
        capture.settings.onQueryCreated?.(fakeQuery(async () => ({ totalTokens: 120_000, maxTokens: 0 })))
        await stopHookOf(capture)()
        expect(capture.read()).toBeUndefined()
    })

    it('times out a hung getContextUsage instead of blocking the turn', async () => {
        vi.useFakeTimers()
        const capture = claudeContextCapture()
        capture.settings.onQueryCreated?.(fakeQuery(() => new Promise(() => {})))
        const pending = stopHookOf(capture)()
        await vi.advanceTimersByTimeAsync(3000)
        await expect(pending).resolves.toEqual({ continue: true })
        expect(capture.read()).toBeUndefined()
    })

    describe('compaction inside a turn', () => {
        type Hook = () => Promise<unknown>
        const hookOf = (capture: ReturnType<typeof claudeContextCapture>, event: 'PreCompact' | 'PostCompact'): Hook => capture.settings.hooks?.[event]?.[0]?.hooks[0] as Hook

        it('reports the CLI compacting and the tokens it gave back', async () => {
            const seen: unknown[] = []
            const capture = claudeContextCapture(undefined, compaction => seen.push(compaction))
            const readings = [160_000, 30_000]
            capture.settings.onQueryCreated?.(fakeQuery(async () => ({ totalTokens: readings.shift(), maxTokens: 200_000 })))

            await expect(hookOf(capture, 'PreCompact')()).resolves.toEqual({ continue: true })
            await expect(hookOf(capture, 'PostCompact')()).resolves.toEqual({ continue: true })

            expect(seen).toEqual([{ status: 'running' }, { status: 'done', tokensRecovered: 130_000 }])
        })

        it('still reports the compaction when the occupancy cannot be read', async () => {
            const seen: unknown[] = []
            const capture = claudeContextCapture(undefined, compaction => seen.push(compaction))
            capture.settings.onQueryCreated?.(fakeQuery(async () => Promise.reject(new Error('ProcessTransport is not ready for writing'))))

            await hookOf(capture, 'PreCompact')()
            await hookOf(capture, 'PostCompact')()

            expect(seen).toEqual([{ status: 'running' }, { status: 'done' }])
        })

        it('keeps the Stop hook beside them, and adds none without a listener', () => {
            const listened = claudeContextCapture(undefined, () => {})
            expect(Object.keys(listened.settings.hooks ?? {})).toEqual(['Stop', 'PreCompact', 'PostCompact'])
            expect(Object.keys(claudeContextCapture().settings.hooks ?? {})).toEqual(['Stop'])
        })
    })

    describe('plan limits', () => {
        const PLAN_USAGE = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
        const occupancy = async () => ({ totalTokens: 1000, maxTokens: 200_000 })

        afterEach(() => {
            forgetPlanLimits('conn')
        })

        it('records the plan windows of the connection on Stop', async () => {
            const capture = claudeContextCapture('conn')
            const query = { getContextUsage: occupancy, [PLAN_USAGE]: async () => ({ rate_limits: { five_hour: { utilization: 42, resets_at: null } } }) }
            capture.settings.onQueryCreated?.(query as unknown as Query)
            await stopHookOf(capture)()
            expect(readPlanLimits('conn')?.windows).toEqual([{ kind: 'session', label: null, usedPercent: 42, resetsAt: null }])
            expect(capture.read()).toEqual({ usedTokens: 1000, maxTokens: 200_000 })
        })

        it('keeps the occupancy when the plan read is gone from the SDK or throws', async () => {
            const renamed = claudeContextCapture('conn')
            renamed.settings.onQueryCreated?.(fakeQuery(occupancy))
            await expect(stopHookOf(renamed)()).resolves.toEqual({ continue: true })

            const throwing = claudeContextCapture('conn')
            const query = {
                getContextUsage: occupancy,
                [PLAN_USAGE]: () => {
                    throw new Error('not supported')
                },
            }
            throwing.settings.onQueryCreated?.(query as unknown as Query)
            await expect(stopHookOf(throwing)()).resolves.toEqual({ continue: true })

            expect(readPlanLimits('conn')).toBeNull()
            expect(throwing.read()).toEqual({ usedTokens: 1000, maxTokens: 200_000 })
        })
    })
})
