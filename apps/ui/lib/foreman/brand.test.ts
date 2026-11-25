import { RERUN_BRAND } from '@rerun/contracts'
import { describe, expect, it, vi } from 'vitest'

import type { ForemanState } from './phase'

vi.mock('server-only', () => ({}))
vi.mock('./onboarding-tools', () => ({ dispatchOnboardingTool: vi.fn() }))

const { foremanEngineInstructions, foremanSystemPrompt } = await import('./prompt')
const { foremanCheckinBrief, foremanEngineBrief } = await import('./engine-brief')
const { foremanActiveTools, foremanTools } = await import('./tools')
const { ACCOUNT_TOOL_DEFS } = await import('@/lib/mcp/account-tools')
const { brandTools } = await import('@/lib/brand/text')

const NORDLYS = { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', supportEmail: 'help@nordlys.example' }

const STATE = {
    phase: 'companion',
    intent: null,
    answers: { company_name: 'Acme', industry: 'ecommerce' },
    foreman: {},
    onboardingCompletedAt: 'then',
    firstName: 'Ada',
    language: 'fr',
    entitled: true,
    trialSpent: false,
    trialNeedsCard: true,
    priceArm: '49',
    client: 'web',
    workspaceName: 'Acme',
    workspacePlan: 'organization',
    userEmail: 'ada@acme.test',
    spaces: [],
    agents: [],
} as unknown as ForemanState

const PHASES = ['discover', 'plan', 'trial', 'build'] as const
const INTENTS = [null, { kind: 'template', slug: 'x' }, { kind: 'template', slug: 'x', description: 'a template' }, { kind: 'share', token: 't' }, { kind: 'prompt', text: 't' }]

function textsUnder(brand: typeof NORDLYS | typeof RERUN_BRAND): Map<string, string> {
    const texts = new Map<string, string>()
    for (const client of ['web', 'ios', 'android'] as const) {
        for (const entitled of [true, false])
            for (const trialSpent of [true, false]) {
                const state = { ...STATE, client, entitled, trialSpent, brand }
                for (const phase of PHASES) for (const [index, intent] of INTENTS.entries()) texts.set(`hub ${client} ${phase} ${index} ${entitled} ${trialSpent}`, foremanSystemPrompt({ ...state, phase, intent } as ForemanState))
                texts.set(`engine ${client} ${entitled}`, foremanEngineInstructions(state, { greeting: true, vault: true }))
            }
    }
    const state = { ...STATE, brand }
    texts.set('brief', JSON.stringify(foremanEngineBrief(state, { vault: true, greeting: true })))
    texts.set('check-in', JSON.stringify(foremanCheckinBrief(state, 'pulse', { vault: true })))
    texts.set('check-in of nobody', JSON.stringify(foremanCheckinBrief({ ...state, language: null }, 'manual')))
    const belt = foremanTools({ ctx: {} as never, turn: { state: () => ({ ...state, phase: 'plan' }), note: () => {} } as never })
    const held = foremanActiveTools({ ...state, phase: 'plan' } as ForemanState)
    for (const name of held) texts.set(`tool ${name}`, JSON.stringify({ description: belt[name]?.description, schema: (belt[name]?.inputSchema as { jsonSchema: unknown }).jsonSchema }))
    texts.set('account tools', JSON.stringify(brandTools(ACCOUNT_TOOL_DEFS, brand)))
    return texts
}

// What a model may still read of the word: a tool name, the keyless provider's own value, and the
// sentence that tells it to keep those to itself.
const NOTE = /Some technical names you read carry another word[^\n]*/g
const IDENTIFIER = /\brerun_[a-z_]+|\brerun-max\b|\brerun(?= \| )|\bRERUN_[A-Z_]+|\\?["'`]rerun\\?["'`]/g

describe('the Chief of Staff under a brand', () => {
    const texts = textsUnder(NORDLYS)

    it('never names Rerun, its addresses nor its community', () => {
        const leaks = [...texts].flatMap(([where, text]) => [...text.replace(NOTE, '').replace(IDENTIFIER, '').matchAll(/.{0,60}(?:rerun|discord).{0,60}/gi)].map(match => `${where}: ${match[0]}`))
        expect([...new Set(leaks.map(leak => leak.replace(/^[^:]*: /, '')))]).toEqual([])
    })

    it('holds no way to the Rerun team, and sends to the support of the organization', () => {
        expect(foremanActiveTools({ ...STATE, phase: 'discover', brand: NORDLYS })).not.toContain('contact_team')
        expect(foremanActiveTools({ ...STATE, phase: 'discover' })).toContain('contact_team')
        for (const [where, text] of texts) expect(text, where).not.toMatch(/contact_team|request_feature/)
        expect(texts.get('hub web discover 0 true true')).toContain('help@nordlys.example')
        expect(texts.get('engine web true')).toContain('help@nordlys.example')
    })

    it('sells nothing: no plan, no bill to open', () => {
        expect(texts.get('engine web true')).toContain('Workspace: Acme. You are')
        expect(texts.get('engine web true')).not.toMatch(/invoices|billing panel/)
        expect(texts.get('engine web false')).not.toMatch(/billing/)
        const settings = foremanEngineBrief({ ...STATE, brand: NORDLYS }).tools.find(tool => tool.name === 'open_settings')
        expect(JSON.stringify(settings)).not.toMatch(/billing|invoice/)
        expect(JSON.stringify(foremanEngineBrief(STATE).tools.find(tool => tool.name === 'open_settings'))).toContain('"billing"')
    })

    it('says exactly what it says to Rerun when it is Rerun', () => {
        expect(foremanEngineBrief({ ...STATE, brand: RERUN_BRAND }, { vault: true })).toEqual(foremanEngineBrief(STATE, { vault: true }))
        const rerun = textsUnder(RERUN_BRAND)
        expect(rerun.get('hub web discover 0 true true')).toContain('You are the Chief of Staff of this Rerun workspace.')
        expect(rerun.get('engine web true')).toContain('docs.rerun.build')
        for (const [where, text] of rerun) expect(text, where).not.toMatch(/Nordlys|Some technical names/)
    })
})
