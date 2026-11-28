import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentViewSchema, boardAgentSchema, COWORKER_COLORS, coworkerLookSchema, prependQuote, QUOTE_FROM_USER, type AgentModels, type AgentView, type AiConnectionsView, type BoardAgent, type ConversationMessage } from '@rerun/contracts'
import { z } from 'zod'

import { shippedBeforeGrok, shippedIosAgentModelsSchema, shippedIosAgentViewSchema, shippedIosConnectionsViewSchema } from '@/test/shipped-ios'
import { agentModelsForClient, agentViewForClient, aiConnectionsForClient, boardAgentsForClient, clientKnowsProvider, clientReadsForemanRuns, emailCodeForClient, messagesForClient } from './legacy-client'

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

    it('trusts every Android build with OpenCode and custom endpoints: the Android app was born knowing them', () => {
        expect(clientKnowsProvider(request('android/1.0.0 (1)'), 'opencode')).toBe(true)
        expect(clientKnowsProvider(request('android/1.0.0 (1)'), 'custom')).toBe(true)
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
        vi.stubEnv('MOBILE_IOS_CUSTOM_BUILD', '52')
        expect(clientKnowsProvider(request('android/1.0.0 (1)'), 'opencode')).toBe(true)
        expect(clientKnowsProvider(request('android/1.0.0 (1)'), 'custom')).toBe(true)
    })

    it('holds each platform to its own first build of Grok, and none while it is not set', () => {
        expect(clientKnowsProvider(request('ios/9.9.9 (999)'), 'grok')).toBe(false)
        expect(clientKnowsProvider(request('android/9.9.9 (999)'), 'grok')).toBe(false)
        vi.stubEnv('MOBILE_IOS_GROK_BUILD', '60')
        vi.stubEnv('MOBILE_ANDROID_GROK_BUILD', '25')
        expect(clientKnowsProvider(request('ios/1.6.0 (60)'), 'grok')).toBe(true)
        expect(clientKnowsProvider(request('ios/1.5.9 (59)'), 'grok')).toBe(false)
        expect(clientKnowsProvider(request('android/1.6.0 (25)'), 'grok')).toBe(true)
        expect(clientKnowsProvider(request('android/1.5.9 (24)'), 'grok')).toBe(false)
        expect(clientKnowsProvider(request('android/1.6.0 (60)'), 'opencode')).toBe(true)
        expect(clientKnowsProvider(request(), 'grok')).toBe(false)
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
        expect(shippedIosConnectionsViewSchema.safeParse(view).success).toBe(false)
        expect(shippedIosConnectionsViewSchema.safeParse(aiConnectionsForClient(old, view)).success).toBe(true)
        expect(shippedIosAgentModelsSchema.safeParse(models).success).toBe(false)
        expect(shippedIosAgentModelsSchema.safeParse(agentModelsForClient(old, models)).success).toBe(true)
        expect(shippedIosAgentViewSchema.safeParse(agentView).success).toBe(false)
        expect(shippedIosAgentViewSchema.safeParse(agentViewForClient(old, agentView)).success).toBe(true)
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

    it('keeps OpenCode for an Android build, with no first build set', () => {
        const android = request('android/1.0.0 (1)')
        expect(aiConnectionsForClient(android, view)).toEqual(view)
        expect(agentModelsForClient(android, models)).toEqual(models)
        expect(agentViewForClient(android, agentView)).toEqual(agentView)
    })

    it('hands a build that knows every provider the response untouched', () => {
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
        vi.stubEnv('MOBILE_IOS_CUSTOM_BUILD', '40')
        vi.stubEnv('MOBILE_IOS_GROK_BUILD', '40')
        const current = request('ios/1.4.0 (40)')
        expect(aiConnectionsForClient(current, view)).toBe(view)
        expect(agentModelsForClient(current, models)).toBe(models)
        expect(agentViewForClient(current, agentView)).toBe(agentView)
    })
})

// Grok came after every build in people's hands, Android ones included.
describe('responses for a build from before Grok', () => {
    const grokView: AiConnectionsView = {
        ...view,
        connections: [...view.connections, { id: 'cnx-grok', name: 'Grok', provider: 'grok', kind: 'plan', status: 'connected', credentialOnFile: true, summary: '', isDefault: false, models: [], baseUrl: '', extraModels: [], planWindows: [] }],
        addable: [...view.addable, { provider: 'grok', kind: 'plan', title: 'Grok', hint: '', suggestedName: 'Grok', guide: null }],
    }
    const grokModels: AgentModels = { ...models, groups: [...models.groups, { connectionId: 'cnx-grok', label: 'Grok', provider: 'grok', models: [{ id: 'grok-4.6', label: 'Grok 4.6' }], defaultModel: 'grok-4.6' }] }
    const onGrok: AgentView = agentViewSchema.parse({ ...agentView, detail: { ...agentView.detail, config: { name: 'Scout', provider: 'grok', connectionId: 'cnx-grok', model: 'grok-4.6' }, resolvedConnectionId: 'cnx-grok', resolvedProvider: 'grok', resolvedModel: 'grok-4.6' } })

    it.each(['android/1.0.4 (18)', 'ios/1.0.6 (51)', 'ios/1.0.6'])('leaves Grok out for %s, which then parses the answer', client => {
        vi.stubEnv('MOBILE_IOS_GROK_BUILD', '60')
        vi.stubEnv('MOBILE_ANDROID_GROK_BUILD', '25')
        const req = request(client)
        expect(shippedBeforeGrok.connectionsView.safeParse(grokView).success).toBe(false)
        expect(shippedBeforeGrok.connectionsView.safeParse(aiConnectionsForClient(req, grokView)).success).toBe(true)
        expect(shippedBeforeGrok.agentModels.safeParse(agentModelsForClient(req, grokModels)).success).toBe(true)
        expect(shippedBeforeGrok.agentView.safeParse(onGrok).success).toBe(false)
        expect(shippedBeforeGrok.agentView.safeParse(agentViewForClient(req, onGrok)).success).toBe(true)
        expect(agentViewForClient(req, onGrok).detail).toMatchObject({ resolvedProvider: null, config: { provider: null, model: null } })
    })

    it('hands Grok to the builds that know it, on either platform', () => {
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', '40')
        vi.stubEnv('MOBILE_IOS_CUSTOM_BUILD', '40')
        vi.stubEnv('MOBILE_IOS_GROK_BUILD', '60')
        vi.stubEnv('MOBILE_ANDROID_GROK_BUILD', '25')
        expect(aiConnectionsForClient(request('ios/1.6.0 (60)'), grokView)).toBe(grokView)
        expect(aiConnectionsForClient(request('android/1.6.0 (25)'), grokView)).toBe(grokView)
    })
})

// The App Store builds parse OpenCode from build 30: a hub that names no first build hid it from every
// iPhone, the machine's default included (RER-396). Leaves with iOS 29, whose snapshot it reads.
describe('the first iOS build of OpenCode', () => {
    const FIRST_IOS_BUILD = '30'
    const shippedIos = (build: number) => readFileSync(path.resolve(import.meta.dirname, `../../../../../mobile/api-contract/shipped/ios-${build}.json`), 'utf8')
    const goWindows = [
        { name: '5 hours', usedPercent: 0, reset: null },
        { name: 'Week', usedPercent: 100, reset: 'Mon' },
        { name: 'Month', usedPercent: 50, reset: 'Dec 24' },
    ]
    const workspace: AiConnectionsView = {
        ...view,
        connections: [
            view.connections[0],
            { ...view.connections[1], name: 'OpenCode Go', planWindows: goWindows },
            { id: 'cnx-codex', name: 'ChatGPT', provider: 'codex', kind: 'plan', status: 'connected', credentialOnFile: true, summary: '', isDefault: false, models: [], baseUrl: '', extraModels: [], planWindows: [] },
            { id: 'cnx-custom', name: 'Ollama', provider: 'custom', kind: 'key', status: 'connected', credentialOnFile: true, summary: '', isDefault: false, models: [], baseUrl: 'http://ollama.local/v1', extraModels: [], planWindows: [] },
            { id: 'cnx-grok', name: 'Grok', provider: 'grok', kind: 'plan', status: 'connected', credentialOnFile: true, summary: '', isDefault: false, models: [], baseUrl: '', extraModels: [], planWindows: [] },
        ],
    }
    const iphone = request('ios/1.0.3 (45)')

    it('is the first build whose providers name it', () => {
        expect(shippedIos(29)).not.toMatch(/"opencode"/)
        expect(shippedIos(30)).toMatch(/"opencode"/)
    })

    it('hides it from an iPhone while the hub names no first build', () => {
        vi.stubEnv('MOBILE_IOS_GROK_BUILD', '54')
        expect(aiConnectionsForClient(iphone, workspace).connections.map(c => c.id)).toEqual(['rerun', 'cnx-codex'])
    })

    it('hands it to an iPhone once the hub names it, with the plan usage of OpenCode Go, and keeps custom endpoints out', () => {
        vi.stubEnv('MOBILE_IOS_GROK_BUILD', '54')
        vi.stubEnv('MOBILE_IOS_OPENCODE_BUILD', FIRST_IOS_BUILD)
        const answer = aiConnectionsForClient(iphone, workspace)
        expect(answer.connections.map(c => c.id)).toEqual(['rerun', 'cnx-oc', 'cnx-codex'])
        expect(answer.connections.find(c => c.id === answer.default.connectionId)).toMatchObject({ provider: 'opencode', kind: 'plan', planWindows: goWindows })
        expect(agentModelsForClient(iphone, models)).toEqual(models)
        expect(agentViewForClient(iphone, agentView)).toEqual(agentView)
        expect(aiConnectionsForClient(request('ios/1.0.0 (29)'), workspace).connections.map(c => c.id)).toEqual(['rerun', 'cnx-codex'])
    })
})

describe('emailCodeForClient', () => {
    it('says no account was created to iOS 18 to 21, which cannot read the answer without it', () => {
        expect(emailCodeForClient(request('ios/1.0.0 (18)'), { mailed: false })).toEqual({ mailed: false, created: false })
        expect(emailCodeForClient(request('ios/1.0.1 (21)'), { mailed: true })).toEqual({ mailed: true, created: false })
        expect(emailCodeForClient(request(), { mailed: false })).toEqual({ mailed: false, created: false })
    })

    it('leaves it out for the builds that never read it', () => {
        expect(emailCodeForClient(request('ios/1.0.2 (23)'), { mailed: false })).toEqual({ mailed: false })
        expect(emailCodeForClient(request('android/1.0.0 (3)'), { mailed: true })).toEqual({ mailed: true })
    })
})

describe('clientReadsForemanRuns', () => {
    it('holds for no build until the first one that reads on screen is named', () => {
        expect(clientReadsForemanRuns(request('ios/1.0.4 (46)'))).toBe(false)
        expect(clientReadsForemanRuns(request('android/1.0.4 (14)'))).toBe(false)
        expect(clientReadsForemanRuns(request())).toBe(false)
    })

    it('holds from the build named for its platform', () => {
        vi.stubEnv('MOBILE_IOS_FOREMAN_RUNS_BUILD', '46')
        vi.stubEnv('MOBILE_ANDROID_FOREMAN_RUNS_BUILD', '14')
        expect(clientReadsForemanRuns(request('ios/1.0.3 (45)'))).toBe(false)
        expect(clientReadsForemanRuns(request('ios/1.0.4 (46)'))).toBe(true)
        expect(clientReadsForemanRuns(request('android/1.0.3 (13)'))).toBe(false)
        expect(clientReadsForemanRuns(request('android/1.0.4 (14)'))).toBe(true)
        expect(clientReadsForemanRuns(request())).toBe(false)
    })
})

// What iOS 45 to 51 and Android 13 to 18 parse a coworker's look against.
const shippedBoardAgentSchema = boardAgentSchema.extend({ look: coworkerLookSchema.extend({ color: z.enum(COWORKER_COLORS) }).nullable().optional() })

describe('boardAgentsForClient', () => {
    const orange: BoardAgent = { ...agentView.agent, id: 'a2', look: { eyes: 'pill', mouth: 'none', color: '#ff7a00', material: 'fluffy' } }
    const blue: BoardAgent = { ...agentView.agent, id: 'a3', look: { eyes: 'pill', mouth: 'none', color: '#0f52ff' } }
    const undressed: BoardAgent = { ...agentView.agent, id: 'a4', look: null }
    const agents = [orange, blue, undressed]

    it('sends a build that knows only the hashed colours the closest of them, which it parses', () => {
        for (const client of ['ios/1.0.9 (51)', 'android/1.0.9 (18)']) {
            const answer = boardAgentsForClient(request(client), agents)
            expect(answer.map(agent => agent.look?.color ?? null)).toEqual(['#f0127f', '#0f52ff', null])
            expect(answer[0].look).toMatchObject({ eyes: 'pill', mouth: 'none', material: 'fluffy' })
            for (const agent of answer) expect(shippedBoardAgentSchema.safeParse(agent).success).toBe(true)
            expect(shippedBoardAgentSchema.safeParse(agentViewForClient(request(client), { ...agentView, agent: orange }).agent).success).toBe(true)
        }
    })

    it('hands a free colour as it is from the build named for its platform', () => {
        vi.stubEnv('MOBILE_IOS_FREE_COLOR_BUILD', '52')
        vi.stubEnv('MOBILE_ANDROID_FREE_COLOR_BUILD', '19')
        expect(boardAgentsForClient(request('ios/1.1.0 (52)'), agents)).toBe(agents)
        expect(boardAgentsForClient(request('android/1.1.0 (19)'), agents)).toBe(agents)
        expect(agentViewForClient(request('ios/1.1.0 (52)'), { ...agentView, agent: orange }).agent.look?.color).toBe('#ff7a00')
        expect(boardAgentsForClient(request('ios/1.0.9 (51)'), agents)[0].look?.color).toBe('#f0127f')
    })
})

describe('messagesForClient', () => {
    const quote = { from: 'Nova', messageId: 'engine-a1', text: 'The split:\n\n7 are hiring right now' }
    const reply: ConversationMessage = { id: 'u2', role: 'user', parts: [{ type: 'text', text: prependQuote('Which ones?', quote) }] }
    const ownPassage: ConversationMessage = { id: 'u3', role: 'user', parts: [{ type: 'text', text: prependQuote('', { ...quote, from: QUOTE_FROM_USER }) }] }
    const answer: ConversationMessage = { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'On it.' }] }
    const messages = [reply, ownPassage, answer]

    it('sends a build from before quotes the passage as a markdown quote', () => {
        for (const client of [undefined, 'ios/1.0.9 (51)', 'android/1.0.9 (18)']) {
            const [quoted, own, untouched] = messagesForClient(request(client), messages)
            expect(quoted.parts).toEqual([{ type: 'text', text: '> **Nova** · The split: · 7 are hiring right now\n\nWhich ones?' }])
            expect(own.parts).toEqual([{ type: 'text', text: '> The split: · 7 are hiring right now' }])
            expect(untouched).toBe(answer)
        }
    })

    it('hands the quote as it is from the build named for its platform', () => {
        vi.stubEnv('MOBILE_IOS_QUOTE_BUILD', '52')
        vi.stubEnv('MOBILE_ANDROID_QUOTE_BUILD', '19')
        expect(messagesForClient(request('ios/1.1.0 (52)'), messages)).toBe(messages)
        expect(messagesForClient(request('android/1.1.0 (19)'), messages)).toBe(messages)
        expect(messagesForClient(request('ios/1.0.9 (51)'), messages)[0].parts[0]).toMatchObject({ text: expect.stringMatching(/^> \*\*Nova\*\*/) })
    })
})
