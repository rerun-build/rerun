import { describe, expect, it } from 'vitest'
import { DEFAULT_CONNECTION_MODELS, OPENCODE_SNAPSHOT, toProviderModel, type ProviderModel } from '@rerun/contracts'
import type { BoxConnection } from '@/lib/engine/types'
import { connectMethod, enabledModels, offeredModels, opencodeModelRows, pricePerMillion, sourceSummary } from './ai-sources'
import { englishTranslator } from '@/lib/i18n/english-translator'
import { connectionMethod } from './ai-connection-analytics'
import { connectionGroups } from './model-groups'

function opencode(overrides: Partial<BoxConnection> = {}): BoxConnection {
    return {
        id: 'cnx-oc',
        name: 'OpenCode',
        provider: 'opencode',
        models: DEFAULT_CONNECTION_MODELS.opencode,
        extraModels: [],
        createdAt: '2026-11-04T00:00:00.000Z',
        connected: true,
        credentialRejected: false,
        planLimits: null,
        cliModels: null,
        providerModels: null,
        discoveredModels: null,
        ...overrides,
    }
}

const credit = { usedMicros: 0, budgetMicros: 0, resetAt: null, percent: 0 }
const fresh: ProviderModel = { id: 'go/glm-6-preview', label: 'GLM-6 Preview', plan: 'go', contextWindow: 1_000_000, images: true, price: { input: 1, output: 3, cacheRead: null } }

describe('connectMethod', () => {
    // OpenCode is sold as a plan and connected with a key: the reconnect must not open Claude's sign-in.
    it('connects OpenCode with a key, like every provider but the two CLIs', () => {
        expect(connectMethod('claude')).toBe('oauth-claude')
        expect(connectMethod('codex')).toBe('device-codex')
        for (const provider of ['opencode', 'anthropic', 'openai', 'google', 'openrouter']) expect(connectMethod(provider), provider).toBe('key')
        expect(connectionMethod('opencode', { OPENCODE_API_KEY: 'oc_sk' })).toBe('api_key')
    })
})

describe('the OpenCode model list of a connection', () => {
    it('reads the snapshot until the box reports its own catalog', () => {
        const rows = opencodeModelRows(opencode(), englishTranslator('connections'))
        expect(rows).toHaveLength(OPENCODE_SNAPSHOT.length)
        expect(rows.filter(row => row.enabled).every(row => row.plan === 'go')).toBe(true)
        expect(rows.some(row => row.isNew)).toBe(false)
    })

    // Free on the Go plan, so listed with the models it pays for, but switched off: a free endpoint
    // can train on what it is sent, and the member says when to use one.
    it('lists the free Go models, switched off', () => {
        const rows = opencodeModelRows(opencode(), englishTranslator('connections'))
        expect(rows.find(row => row.id === 'go/beam-free')).toMatchObject({ free: true, enabled: false, plan: 'go' })
        expect(rows.filter(row => row.free).every(row => !row.enabled)).toBe(true)
        expect(rows.find(row => row.id === 'go/deepseek-v4-pro')).toMatchObject({ free: false, enabled: true })
    })

    it('marks a model newer than the snapshot as new, and keeps a retired one to be switched off', () => {
        const live = [...OPENCODE_SNAPSHOT.map(toProviderModel).filter(model => model.id !== 'go/glm-5.2'), fresh]
        const rows = opencodeModelRows(opencode({ providerModels: live }), englishTranslator('connections'))
        expect(rows.find(row => row.id === 'go/glm-6-preview')).toMatchObject({ isNew: true, enabled: false, plan: 'go' })
        expect(rows.find(row => row.id === 'go/glm-5.2')).toMatchObject({ info: null, enabled: true, unavailable: 'No longer offered by OpenCode' })
    })

    it('reads a Console price per million tokens', () => {
        expect(pricePerMillion({ input: 2, output: 10, cacheRead: 0.2 }, englishTranslator('connections'), 'en')).toBe('$2 in · $10 out /M')
        expect(pricePerMillion({ input: 0.834, output: 2.501, cacheRead: null }, englishTranslator('connections'), 'en')).toBe('$0.834 in · $2.501 out /M')
    })

    it('offers the live catalog in the pickers, the snapshot without one', () => {
        expect(offeredModels(opencode({ providerModels: [fresh] })).map(model => model.id)).toEqual(['go/glm-6-preview', ...DEFAULT_CONNECTION_MODELS.opencode])
        expect(enabledModels(opencode()).map(model => model.id)).toEqual(DEFAULT_CONNECTION_MODELS.opencode)
    })

    it('summarises the three Go windows once there is a reading', () => {
        const windows = [
            { kind: 'session' as const, label: null, usedPercent: 12, resetsAt: null },
            { kind: 'weekly' as const, label: null, usedPercent: 40, resetsAt: null },
            { kind: 'monthly' as const, label: null, usedPercent: 5, resetsAt: null },
        ]
        expect(sourceSummary(opencode({ planLimits: { windows, capturedAt: '2026-11-04T00:00:00.000Z' } }), credit, englishTranslator('connections'), 'en')).toBe('5-hour 12% · Weekly 40% · Monthly 5%')
    })
})

describe('OpenCode in the model pickers', () => {
    const connection = opencode({ models: ['console/claude-sonnet-5-5', 'go/deepseek-v4-pro', 'console/gpt-6-sol', 'go/longcat-2.5-free', 'go/glm-5.3'] })

    // One group for the connection, whatever its two catalogs: the iOS app keys the running model on it.
    // A free Go model says so, as the connection dialog does, rather than "Included in Go".
    it('lists one group, Go before Console, with what each costs as its description', () => {
        const groups = connectionGroups([connection], true, englishTranslator('connections'))
        expect(groups).toHaveLength(1)
        expect(groups[0].models.map(model => [model.id, model.description])).toEqual([
            ['go/deepseek-v4-pro', 'Included in Go'],
            ['go/longcat-2.5-free', 'Free'],
            ['go/glm-5.3', 'Included in Go'],
            ['console/claude-sonnet-5-5', 'Console credits'],
            ['console/gpt-6-sol', 'Console credits'],
        ])
    })

    it('greys out a model OpenCode no longer offers, and does not default to it', () => {
        const live = OPENCODE_SNAPSHOT.map(toProviderModel).filter(model => model.id !== 'go/deepseek-v4-pro')
        const [group] = connectionGroups([opencode({ models: ['go/deepseek-v4-pro', 'go/glm-5.3'], providerModels: live })], true, englishTranslator('connections'))
        expect(group.models.find(model => model.id === 'go/deepseek-v4-pro')?.unavailable).toBe('No longer offered by OpenCode')
        expect(group.defaultModel).toBe('go/glm-5.3')
    })

    it('locks the premium Console models on a trial, never the Go ones', () => {
        const [group] = connectionGroups([opencode({ models: ['go/deepseek-v4-pro', 'console/claude-opus-5-5', 'console/gpt-6-astra'] })], false, englishTranslator('connections'))
        expect(group.models.filter(model => model.locked).map(model => model.id)).toEqual(['console/claude-opus-5-5', 'console/gpt-6-astra'])
    })
})
