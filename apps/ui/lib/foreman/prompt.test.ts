import { describe, expect, it, vi } from 'vitest'

import { BILLING_ENABLED } from '@rerun/cloud/billing'

vi.mock('server-only', () => ({}))

const { MOBILE_APP_BLOCK, firstWeekBlock, foremanEngineInstructions, foremanSystemPrompt } = await import('./prompt')
import type { ForemanPlan, ForemanState } from './phase'

const OLD_BOX = { connectApp: false, wakes: false }

const ASKED = 'Je cherche un worker capable de trouver des décisionnaires capables de me recruter en alternance'

const HIRING_LEADS = { kind: 'agent' as const, name: 'Hiring Leads', role: 'Finds potential apprenticeship hiring managers and delivers leads for review', need: ASKED, asked: ASKED, box: 'Sales' }

const PLAN: ForemanPlan = { title: 'Your first coworker for finding an apprenticeship', boxes: [{ name: 'Sales' }], items: [HIRING_LEADS] }

function stateWith(patch: Partial<ForemanState>): ForemanState {
    return {
        phase: 'companion',
        intent: null,
        answers: {},
        foreman: { profileAt: 'then', useCases: ['Trouver de nouveaux clients'], needs: [{ job: 'Trouver de nouveaux clients', pain: 'Je ne sais pas où trouver les décideurs' }] },
        onboardingCompletedAt: 'then',
        firstName: 'Nico',
        language: 'fr',
        entitled: true,
        trialSpent: false,
        trialNeedsCard: true,
        priceArm: '49',
        client: 'web',
        workspaceName: "Nico's workspace",
        workspacePlan: 'base',
        userEmail: null,
        spaces: [],
        agents: [],
        ...patch,
    }
}

describe('foremanEngineInstructions', () => {
    it('knows that only a coworker on a ChatGPT connection can generate an image, and says who to hand it to', () => {
        const prompt = foremanEngineInstructions(stateWith({}), OLD_BOX)
        expect(prompt).toContain('runs on a ChatGPT connection (provider codex) generates and edits images')
        expect(prompt).toContain('hand it the request with send_message')
        expect(prompt).toContain('Never tell the user that the ChatGPT plan only covers text')
    })

    it('carries the coworker they agreed on and their correction, over what the interview heard first', () => {
        const instructions = foremanEngineInstructions(stateWith({ foreman: { ...stateWith({}).foreman, plan: PLAN } }), OLD_BOX)
        expect(instructions).toContain('The first coworker they agreed on during onboarding: Hiring Leads, Finds potential apprenticeship hiring managers and delivers leads for review.')
        expect(instructions).toContain(`What they asked for when they changed it, in their own words: "${ASKED}"`)
        expect(instructions).toContain('Where this and what you know above disagree, this wins')
    })

    it('cuts a long correction short, since it is read on every turn', () => {
        const long = 'a'.repeat(2000)
        const instructions = foremanEngineInstructions(stateWith({ foreman: { plan: { ...PLAN, items: [{ ...HIRING_LEADS, asked: long }] } } }), OLD_BOX)
        expect(instructions).toContain(`"${'a'.repeat(600)}…"`)
        expect(instructions).not.toContain('a'.repeat(601))
    })

    it('names the coworker alone when the card came back confirmed as it was drawn', () => {
        const instructions = foremanEngineInstructions(stateWith({ foreman: { plan: { ...PLAN, items: [{ kind: 'agent', name: 'Closer', role: 'Answers demo requests' }] } } }), OLD_BOX)
        expect(instructions).toContain('The first coworker they agreed on during onboarding: Closer, Answers demo requests.')
        expect(instructions).not.toContain('when they changed it')
    })

    it('says nothing of a plan for a workspace that never had one, or whose plan was a template', () => {
        expect(foremanEngineInstructions(stateWith({}), OLD_BOX)).not.toContain('agreed on during onboarding')
        expect(foremanEngineInstructions(stateWith({ foreman: { plan: { title: 'Team', items: [{ kind: 'template', slug: 'buyer-signals' }] } } }), OLD_BOX)).not.toContain('agreed on during onboarding')
    })
})

describe('foremanSystemPrompt', () => {
    it('leaves the agreed plan to the engine: on the hub the card is still being decided', () => {
        expect(foremanSystemPrompt(stateWith({ phase: 'trial', entitled: false, foreman: { ...stateWith({}).foreman, plan: PLAN } }))).not.toContain('agreed on during onboarding')
    })
})

describe('foremanSystemPrompt in the app', () => {
    const PRICE = /\$\d|a month|card required|free trial|Start free trial|Talk to the team/i

    it.each(['ios', 'android'] as const)('keeps every price, card and trial out of the plan and trial steps on %s', client => {
        for (const phase of ['plan', 'trial'] as const) {
            for (const trialSpent of [false, true]) {
                const prompt = foremanSystemPrompt(stateWith({ phase, entitled: false, trialSpent, client, foreman: { ...stateWith({}).foreman, plan: PLAN } }))
                expect(prompt).toContain(MOBILE_APP_BLOCK)
                expect(prompt).toContain('They are in the Rerun mobile app.')
                expect(prompt).not.toMatch(PRICE)
            }
        }
    })

    it.each(['ios', 'android'] as const)('leaves the build to the button of the app at the plan step on %s', client => {
        const prompt = foremanSystemPrompt(stateWith({ phase: 'plan', entitled: false, client, onboardingCompletedAt: null }))
        expect(prompt).toContain('the app asks them to start the build')
        expect(prompt).not.toContain('the app puts the free trial in front of them')
    })

    it.skipIf(!BILLING_ENABLED).each(['ios', 'android'] as const)('sends a spent trial to the web on %s, and anything else back to the button', client => {
        expect(foremanSystemPrompt(stateWith({ phase: 'trial', entitled: false, trialSpent: true, client }))).toContain('finish setting it up at rerun.build')
        expect(foremanSystemPrompt(stateWith({ phase: 'trial', entitled: false, trialSpent: false, client }))).toContain('"Build my team" button right under your reply tries again')
    })

    it('says nothing of the mobile app on the web', () => {
        const prompt = foremanSystemPrompt(stateWith({ phase: 'plan', entitled: false, client: 'web', onboardingCompletedAt: null }))
        expect(prompt).not.toContain(MOBILE_APP_BLOCK)
        expect(prompt).toContain('the app puts the free trial in front of them')
    })

    it.skipIf(!BILLING_ENABLED)('still quotes the price on the web', () => {
        expect(foremanSystemPrompt(stateWith({ phase: 'trial', entitled: false, client: 'web' }))).toMatch(/\$49 a month/)
        expect(foremanSystemPrompt(stateWith({ phase: 'trial', entitled: false, client: 'web' }))).not.toContain('mobile app')
    })

    // The workspace named it: it introduces itself by that name and stays their Chief of Staff.
    it('takes the name the workspace gave it, and only then', () => {
        expect(foremanEngineInstructions(stateWith({ assistantName: 'Max' }), OLD_BOX)).toContain('named you Max')
        expect(foremanEngineInstructions(stateWith({}), OLD_BOX)).not.toContain('named you')
    })

    // Paced on the workspace's age: the moments to plan, and only during its first week.
    it('plans the first week, and only that week, where it can wake', () => {
        const now = Date.parse('2026-11-18T10:00:00Z')
        const young = stateWith({ workspaceCreatedAt: '2026-11-16T09:00:00Z', trialEndsAt: '2026-11-30T09:00:00Z' })
        expect(firstWeekBlock(young, now)).toContain('day 3 of its first week')
        expect(firstWeekBlock(young, now)).toContain('2026-11-30')
        expect(firstWeekBlock(stateWith({ workspaceCreatedAt: '2026-10-01T09:00:00Z' }), now)).toBeNull()
        expect(foremanEngineInstructions(young, { connectApp: false, wakes: false })).not.toContain('first week')
    })
})
