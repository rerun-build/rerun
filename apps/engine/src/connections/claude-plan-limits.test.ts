import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-claude-usage-'))

const { refreshClaudePlanLimits, refreshClaudePlanLimitsAfterRun, refreshStaleClaudePlanLimits, pendingClaudePlanLimits, forgetClaudePlanLimitsAttempt } = await import('./claude-plan-limits.js')
const { forgetPlanLimits, readPlanLimits, recordPlanLimits } = await import('./plan-limits.js')

const USAGE_ANSWER = {
    five_hour: { utilization: 66.0, resets_at: '2026-11-18T14:30:00.000000+00:00' },
    seven_day: { utilization: 80.0, resets_at: '2026-11-23T02:59:59.791029+00:00', limit_dollars: null, used_dollars: null },
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [
        { kind: 'weekly_all', group: 'weekly', percent: 80, severity: 'warning', resets_at: '2026-11-23T02:59:59.791029+00:00', scope: null, is_active: true },
        { kind: 'weekly_scoped', group: 'weekly', percent: 70, severity: 'normal', resets_at: '2026-11-23T02:59:59.791171+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false },
    ],
}

const realFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

function answer(body: unknown, status = 200): void {
    fetchMock.mockImplementation(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
}

const FAR_FUTURE = String(Date.now() + 24 * 3_600_000)

function connection(env: Record<string, string>, id = 'claude-1') {
    return { id, config: { name: 'Claude', provider: 'claude', models: [], extraModels: [], createdAt: '' }, env: { ...env } } as any
}

const signedIn = (id = 'claude-1') => connection({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-access', CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'sk-ant-ort-refresh', CLAUDE_CODE_OAUTH_EXPIRES_AT: FAR_FUTURE }, id)

beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as any
    forgetPlanLimits('claude-1')
    forgetClaudePlanLimitsAttempt('claude-1')
})

afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = realFetch
})

describe('refreshClaudePlanLimits', () => {
    it('reads the windows of the plan, the per-model ones included', async () => {
        answer(USAGE_ANSWER)
        await refreshClaudePlanLimits(signedIn())
        expect(readPlanLimits('claude-1')?.windows).toEqual([
            { kind: 'session', label: null, usedPercent: 66, resetsAt: '2026-11-18T14:30:00.000000+00:00' },
            { kind: 'weekly', label: null, usedPercent: 80, resetsAt: '2026-11-23T02:59:59.791029+00:00' },
            { kind: 'model', label: 'Fable', usedPercent: 70, resetsAt: '2026-11-23T02:59:59.791171+00:00' },
        ])
    })

    it('asks with the access token of the connection', async () => {
        answer(USAGE_ANSWER)
        await refreshClaudePlanLimits(signedIn())
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.anthropic.com/api/oauth/usage')
        expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-ant-oat-access', 'anthropic-beta': 'oauth-2025-04-20' })
    })

    it('never asks with a pasted token, which lacks the profile scope', async () => {
        answer(USAGE_ANSWER)
        await refreshClaudePlanLimits(connection({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-pasted' }))
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps the reading it had when the endpoint refuses', async () => {
        const windows = [{ kind: 'session' as const, label: null, usedPercent: 40, resetsAt: null }]
        recordPlanLimits('claude-1', windows)
        answer({ error: 'forbidden' }, 403)
        await refreshClaudePlanLimits(signedIn())
        expect(readPlanLimits('claude-1')?.windows).toEqual(windows)
    })

    it('keeps the reading it had when the answer changed shape', async () => {
        const windows = [{ kind: 'session' as const, label: null, usedPercent: 40, resetsAt: null }]
        recordPlanLimits('claude-1', windows)
        answer({ unexpected: true })
        await refreshClaudePlanLimits(signedIn())
        expect(readPlanLimits('claude-1')?.windows).toEqual(windows)
    })

    it('sends one request for two asks at once', async () => {
        answer(USAGE_ANSWER)
        const cnx = signedIn()
        const first = refreshClaudePlanLimits(cnx)
        expect(pendingClaudePlanLimits('claude-1')).toBeDefined()
        await Promise.all([first, refreshClaudePlanLimits(cnx)])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})

describe('refreshStaleClaudePlanLimits', () => {
    it('reads a connection whose reading is older than five minutes', async () => {
        answer(USAGE_ANSWER)
        vi.useFakeTimers({ now: Date.now() - 20 * 60_000, toFake: ['Date'] })
        recordPlanLimits('claude-1', [{ kind: 'session', label: null, usedPercent: 40, resetsAt: null }])
        vi.useRealTimers()
        refreshStaleClaudePlanLimits([signedIn()])
        await pendingClaudePlanLimits('claude-1')
        expect(readPlanLimits('claude-1')?.windows[0]).toMatchObject({ kind: 'session', usedPercent: 66 })
    })

    it('leaves alone a reading a run took a minute ago', () => {
        recordPlanLimits('claude-1', [{ kind: 'session', label: null, usedPercent: 40, resetsAt: null }])
        refreshStaleClaudePlanLimits([signedIn()])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('asks again only five minutes after an attempt that read nothing', async () => {
        answer({ error: 'overloaded' }, 529)
        refreshStaleClaudePlanLimits([signedIn()])
        await pendingClaudePlanLimits('claude-1')
        refreshStaleClaudePlanLimits([signedIn()])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})

describe('refreshClaudePlanLimitsAfterRun', () => {
    it('reads after a run that left no reading behind', async () => {
        answer(USAGE_ANSWER)
        refreshClaudePlanLimitsAfterRun(signedIn(), Date.now() - 1000)
        await pendingClaudePlanLimits('claude-1')
        expect(readPlanLimits('claude-1')?.windows[0]).toMatchObject({ usedPercent: 66 })
    })

    it('does not ask again after a run whose Stop hook already read', () => {
        const startedAt = Date.now() - 1000
        recordPlanLimits('claude-1', [{ kind: 'session', label: null, usedPercent: 40, resetsAt: null }])
        refreshClaudePlanLimitsAfterRun(signedIn(), startedAt)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
