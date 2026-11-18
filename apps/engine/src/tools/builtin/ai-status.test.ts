import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-ai-status-'))
process.env.RERUN_HUB_BASE_URL = 'https://hub.test'
process.env.RERUN_API_KEY = 'box-key'

const hub = vi.hoisted(() => ({ answer: null as unknown, calls: [] as string[] }))
const connections = vi.hoisted(() => ({ list: [] as unknown[] }))

vi.mock('../../runtime/hub.js', () => ({
    callHub: async (_caller: unknown, tool: string) => {
        hub.calls.push(tool)
        if (hub.answer instanceof Error) throw hub.answer
        return hub.answer
    },
}))
vi.mock('../../connections/registry.js', () => ({ listConnections: async () => connections.list }))
vi.mock('../../connections/default.js', () => ({ readBoxDefault: async () => ({ connectionId: 'claude-1', model: 'claude-sonnet-4-5' }) }))
vi.mock('../../agents/rerun-upstream.js', () => ({ answeringModel: async (provider: string, model: string) => (provider === 'rerun' ? 'upstream/balanced-model' : model) }))

const { beforeEach, describe, expect, it } = await import('vitest')
const { aiStatusTools } = await import('./ai-status.js')
const { recordPlanLimits } = await import('../../connections/plan-limits.js')
const { recordCredentialRejected } = await import('../../connections/credential-rejections.js')

const config = (provider: string, name: string, models: string[]) => ({ name, provider, models, extraModels: [], createdAt: '2026-11-01T00:00:00Z' })
const rerun = { id: 'rerun', config: config('rerun', 'Rerun', ['rerun-balanced', 'rerun-max']), env: {} }
const claude = { id: 'claude-1', config: config('claude', 'Claude (Theo)', ['claude-sonnet-4-5']), env: { CLAUDE_CODE_OAUTH_TOKEN: 't' } }
const openai = { id: 'openai-1', config: config('openai', 'OpenAI', ['gpt-5']), env: { OPENAI_API_KEY: 'k' } }

function status(provider: string, model: string, connection: unknown) {
    const t = aiStatusTools({ agent: { id: 'scout', resolved: { connection, provider, model } }, provider, model } as any).ai_status as any
    return t.execute({}, { toolCallId: 'c', messages: [] })
}

beforeEach(() => {
    hub.calls.length = 0
    hub.answer = { credit: { remainingMicros: 12_340_000, usedMicros: 7_660_000, totalMicros: 20_000_000, paused: false, resetsAt: '2026-12-01T00:00:00Z' } }
    connections.list = [rerun, claude, openai]
})

describe('ai_status', () => {
    it('names the run, the default, every connection and the credit in credits', async () => {
        recordPlanLimits('claude-1', [{ kind: 'session', label: null, usedPercent: 42, resetsAt: '2026-11-11T18:00:00Z' }])
        recordCredentialRejected('openai-1')

        const out = await status('rerun', 'rerun-balanced', rerun)

        expect(out.current).toEqual({ connectionId: 'rerun', connectionName: 'Rerun', provider: 'Moldwright', model: 'rerun-balanced', answeringModel: 'upstream/balanced-model' })
        expect(out.workspaceDefault).toEqual({ connectionId: 'claude-1', model: 'claude-sonnet-4-5' })
        expect(out.rerunCredit).toEqual({ remainingCredits: 1234, usedCredits: 766, totalCredits: 2000, paused: false, resetsAt: '2026-12-01T00:00:00Z' })
        expect(hub.calls).toEqual(['rerun_credit'])

        const [rerunRow, claudeRow, openaiRow] = out.connections
        expect(rerunRow).toMatchObject({ billing: 'rerun_credit', connected: true, models: ['rerun-balanced', 'rerun-max'], planLimits: null })
        expect(claudeRow).toMatchObject({ provider: 'Claude', billing: 'subscription', connected: true, limitReached: false })
        expect(claudeRow.planLimits.windows).toEqual([{ kind: 'session', label: null, usedPercent: 42, resetsAt: '2026-11-11T18:00:00Z' }])
        expect(openaiRow).toMatchObject({ billing: 'api_key', credentialRejected: true })
    })

    it('leaves the credit out when the hub has none or does not answer', async () => {
        hub.answer = { credit: null }
        expect((await status('claude', 'claude-sonnet-4-5', claude)).rerunCredit).toBeNull()

        hub.answer = new Error('Hub call failed (502)')
        const out = await status('claude', 'claude-sonnet-4-5', claude)
        expect(out.rerunCredit).toBeNull()
        expect(out.current).toEqual({ connectionId: 'claude-1', connectionName: 'Claude (Theo)', provider: 'Claude', model: 'claude-sonnet-4-5' })
    })

    it('never hands over a credential', async () => {
        expect(JSON.stringify(await status('openai', 'gpt-5', openai))).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|box-key/)
    })
})
