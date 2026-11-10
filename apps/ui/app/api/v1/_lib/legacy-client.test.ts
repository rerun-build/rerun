import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { agentConfigSchema, agentDetailSchema, agentModelsSchema, agentViewSchema, aiConnectionsViewSchema, type AgentModels, type AgentView, type AiConnectionsView } from '@rerun/contracts'
import { agentModelsForClient, agentViewForClient, aiConnectionsForClient, clientKnowsProvider } from './legacy-client'

// The provider list as the iOS builds already shipped parse it.
const legacyProvider = z.enum(['rerun', 'anthropic', 'claude', 'codex', 'openai', 'google', 'openrouter'])
const legacyConnectionsView = aiConnectionsViewSchema.extend({
    connections: z.array(aiConnectionsViewSchema.shape.connections.element.extend({ provider: legacyProvider })),
    addable: z.array(aiConnectionsViewSchema.shape.addable.element.extend({ provider: legacyProvider.exclude(['rerun']) })),
})
const legacyModels = agentModelsSchema.extend({ groups: z.array(agentModelsSchema.shape.groups.element.extend({ provider: legacyProvider })) })
const legacyAgentView = agentViewSchema.extend({
    detail: agentDetailSchema
        .extend({ config: agentConfigSchema.extend({ provider: legacyProvider.nullable().default(null) }), resolvedProvider: legacyProvider.nullable().default(null) })
        .nullable(),
})

const request = (client?: string) => new Request('https://app.rerun.build/api/v1/agents/a1', { headers: client ? { 'x-rerun-client': client } : {} })

const view: AiConnectionsView = {
    connections: [
        { id: 'rerun', name: 'Rerun', provider: 'rerun', kind: 'included', status: 'connected', credentialOnFile: true, summary: '', isDefault: false, models: [], baseUrl: '', extraModels: [], planWindows: [] },
        { id: 'cnx-oc', name: 'OpenCode', provider: 'opencode', kind: 'plan', status: 'connected', credentialOnFile: true, summary: '', isDefault: true, models: [], baseUrl: '', extraModels: [], planWindows: [] },
    ],
    default: { connectionId: 'cnx-oc', model: 'go/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    credit: { percent: 0, usedUp: false, backOn: 'next month' },
    addable: [
        { provider: 'claude', kind: 'plan', title: 'Claude', hint: '', suggestedName: 'Claude', guide: null },
        { provider: 'opencode', kind: 'plan', title: 'OpenCode', hint: '', suggestedName: 'OpenCode', guide: null },
    ],
}

const models: AgentModels = {
    groups: [
        { connectionId: 'rerun', label: 'Rerun', provider: 'rerun', models: [{ id: 'rerun-max', label: 'Rerun' }], defaultModel: 'rerun-max' },
        { connectionId: 'cnx-oc', label: 'OpenCode', provider: 'opencode', models: [{ id: 'go/deepseek-v4-pro', label: 'DeepSeek V4 Pro' }], defaultModel: 'go/deepseek-v4-pro' },
    ],
    pinned: null,
    resolved: { connectionId: 'cnx-oc', model: 'go/deepseek-v4-pro' },
    boxDefault: { connectionId: 'cnx-oc', model: 'go/deepseek-v4-pro' },
}

const agentView: AgentView = agentViewSchema.parse({
    agent: { id: 'a1', name: 'Scout', handle: null, description: null, templateId: null, status: 'idle', workspaceId: 7, spaceId: 's1', disabledAt: null, disabledReason: null },
    detail: {
        id: 'engine-a1',
        config: { name: 'Scout', provider: 'opencode', connectionId: 'cnx-oc', model: 'go/glm-5.3' },
        soul: '',
        resolvedConnectionId: 'cnx-oc',
        resolvedProvider: 'opencode',
        resolvedModel: 'go/glm-5.3',
    },
    locked: false,
})

afterEach(() => vi.unstubAllEnvs())

describe('clientKnowsProvider', () => {
    it('trusts only an iOS build at or past the first one that parses OpenCode', () => {
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
        expect(clientKnowsProvider(request('ios/1.4.0 (40)'), 'opencode')).toBe(true)
        expect(clientKnowsProvider(request('ios/1.4.0 (41)'), 'opencode')).toBe(true)
        expect(clientKnowsProvider(request('ios/1.3.0 (39)'), 'opencode')).toBe(false)
        expect(clientKnowsProvider(request(), 'opencode')).toBe(false)
        expect(clientKnowsProvider(request('curl/8'), 'opencode')).toBe(false)
    })

    it('holds each provider to its own first build', () => {
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
        vi.stubEnv('MOBILE_IOS_CUSTOM_BUILD', '52')
        expect(clientKnowsProvider(request('ios/1.4.0 (45)'), 'opencode')).toBe(true)
        expect(clientKnowsProvider(request('ios/1.4.0 (45)'), 'custom')).toBe(false)
        expect(clientKnowsProvider(request('ios/1.5.0 (52)'), 'custom')).toBe(true)
        expect(clientKnowsProvider(request(), 'anthropic')).toBe(true)
    })

    it('trusts no build while the first one is not set', () => {
        expect(clientKnowsProvider(request('ios/9.9.9 (999)'), 'opencode')).toBe(false)
    })

    it('trusts every Android build: the Android app was born knowing every provider', () => {
        expect(clientKnowsProvider(request('android/1.0.0 (1)'), 'opencode')).toBe(true)
        expect(clientKnowsProvider(request('android/1.0.0 (1)'), 'custom')).toBe(true)
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
        vi.stubEnv('MOBILE_IOS_CUSTOM_BUILD', '52')
        expect(clientKnowsProvider(request('android/1.0.0 (1)'), 'opencode')).toBe(true)
        expect(clientKnowsProvider(request('android/1.0.0 (1)'), 'custom')).toBe(true)
    })

    it('reads a header it cannot parse as an old build, whatever platform it names', () => {
        expect(clientKnowsProvider(request('android/1.0.0'), 'opencode')).toBe(false)
        expect(clientKnowsProvider(request('windows/1.0.0 (1)'), 'opencode')).toBe(false)
    })
})

// The point of the filter: what an older build receives parses with the schemas it was built with,
// even with OpenCode as the machine's default and as a coworker's pin.
describe('responses for an older build', () => {
    const old = request('ios/1.3.0 (39)')

    it('parse with the provider list that build knows', () => {
        expect(legacyConnectionsView.safeParse(view).success).toBe(false)
        expect(legacyConnectionsView.safeParse(aiConnectionsForClient(old, view)).success).toBe(true)
        expect(legacyModels.safeParse(models).success).toBe(false)
        expect(legacyModels.safeParse(agentModelsForClient(old, models)).success).toBe(true)
        expect(legacyAgentView.safeParse(agentView).success).toBe(false)
        expect(legacyAgentView.safeParse(agentViewForClient(old, agentView)).success).toBe(true)
    })

    it('reads an OpenCode pin as following the machine, and the resolution as unknown', () => {
        const detail = agentViewForClient(old, agentView).detail!
        expect(detail.config).toMatchObject({ provider: null, model: null })
        expect(detail).toMatchObject({ resolvedProvider: null, resolvedModel: null })
    })

    it('leaves everything else as it was', () => {
        expect(aiConnectionsForClient(old, view).connections.map(c => c.id)).toEqual(['rerun'])
        expect(aiConnectionsForClient(old, view).addable.map(a => a.provider)).toEqual(['claude'])
        expect(agentModelsForClient(old, models).groups.map(g => g.connectionId)).toEqual(['rerun'])
    })

    it('hands an Android build the response untouched, with no first build set', () => {
        const android = request('android/1.0.0 (1)')
        expect(aiConnectionsForClient(android, view)).toBe(view)
        expect(agentModelsForClient(android, models)).toBe(models)
        expect(agentViewForClient(android, agentView)).toBe(agentView)
    })

    it('hands a build that knows every provider the response untouched', () => {
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
        vi.stubEnv('MOBILE_IOS_CUSTOM_BUILD', '40')
        const current = request('ios/1.4.0 (40)')
        expect(aiConnectionsForClient(current, view)).toBe(view)
        expect(agentModelsForClient(current, models)).toBe(models)
        expect(agentViewForClient(current, agentView)).toBe(agentView)
    })
})
