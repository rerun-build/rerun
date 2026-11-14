import { afterEach, describe, expect, it, vi } from 'vitest'

const edition = vi.hoisted(() => ({ cloud: true }))
vi.mock('@rerun/cloud/edition', () => ({
    get RERUN_CLOUD() {
        return edition.cloud
    },
}))

import { foremanPhase, foremanUseCases, type ForemanPhase, type ForemanProfile, type ForemanState } from './phase'
import { intakeBoxes } from '@/lib/onboarding/intake'
import { forcesFirstPlan, PHASES, phaseSpec, phaseTools, pinnedPlanBoxes, planKinds, type ActiveForemanPhase } from './phases'
import { FOREMAN_TOOL_NAMES } from './tool-defs'

const fresh = { foreman: {} as ForemanProfile, onboardingCompletedAt: null, entitled: false, agentCount: 0 }
const profiled: ForemanProfile = { profileAt: '2026-09-21T10:00:00Z' }
const planned: ForemanProfile = { ...profiled, plan: { title: 'Team', items: [{ kind: 'agent', name: 'Scout', role: 'research' }] } }
const intent = { kind: 'template', slug: 'seo-newsroom' } as const

function stateOf(phase: ForemanPhase, patch: Partial<ForemanState> = {}): ForemanState {
    return { phase, intent: null, answers: {}, foreman: {}, onboardingCompletedAt: null, firstName: '', language: null, entitled: false, trialSpent: false, trialNeedsCard: true, priceArm: '49', client: 'web', workspaceName: 'Acme', workspacePlan: 'none', userEmail: null, spaces: [], agents: [], ...patch }
}

function beltOf(phase: ActiveForemanPhase, patch: Partial<ForemanState> = {}): readonly string[] {
    return phaseTools(PHASES[phase], stateOf(phase, patch))
}

describe('a self-hosted install, where every workspace is entitled from its first minute', () => {
    afterEach(() => {
        edition.cloud = true
    })

    it('walks a new workspace through the funnel', () => {
        edition.cloud = false
        expect(foremanPhase({ ...fresh, entitled: true })).toBe('discover')
        expect(foremanPhase({ ...fresh, foreman: profiled, entitled: true })).toBe('plan')
        expect(foremanPhase({ ...fresh, foreman: planned, entitled: true })).toBe('build')
    })

    it('leaves a workspace that already holds coworkers to the companion', () => {
        edition.cloud = false
        expect(foremanPhase({ ...fresh, entitled: true, agentCount: 1 })).toBe('companion')
    })

    it('hands every workspace to the foreman on the engine when the hub has no key to run the onboarding on', () => {
        edition.cloud = false
        expect(foremanPhase({ ...fresh, entitled: true, hubForeman: false })).toBe('companion')
        expect(foremanPhase({ ...fresh, foreman: profiled, entitled: true, hubForeman: false })).toBe('companion')
        expect(foremanPhase({ ...fresh, foreman: planned, entitled: true, hubForeman: false })).toBe('companion')
        expect(foremanPhase({ ...fresh, entitled: true, arrivedReadyMade: true, hubForeman: false })).toBe('companion')
    })

    it('makes the first plan a tool call, since no starter pack opens this step', () => {
        const shown = { id: 'a', role: 'assistant', parts: [{ type: 'tool-show_plan', state: 'output-available', toolCallId: 'c', input: planned.plan, output: {} }] } as never
        const planning = stateOf('plan', { foreman: profiled })
        expect(forcesFirstPlan(planning, [])).toBe(false)
        edition.cloud = false
        expect(forcesFirstPlan(planning, [])).toBe(true)
        expect(forcesFirstPlan(planning, [shown])).toBe(false)
        expect(forcesFirstPlan(stateOf('plan', { foreman: profiled, intent }), [])).toBe(false)
        expect(forcesFirstPlan(stateOf('plan'), [])).toBe(false)
        expect(forcesFirstPlan(stateOf('discover', { foreman: profiled }), [])).toBe(false)
    })
})

describe('foremanPhase', () => {
    it('walks a brand new workspace from discover to the built team', () => {
        expect(foremanPhase(fresh)).toBe('discover')
        expect(foremanPhase({ ...fresh, foreman: profiled })).toBe('plan')
        expect(foremanPhase({ ...fresh, foreman: planned })).toBe('trial')
        expect(foremanPhase({ ...fresh, foreman: planned, entitled: true })).toBe('build')
        expect(foremanPhase({ ...fresh, foreman: planned, entitled: true, agentCount: 2 })).toBe('companion')
        expect(foremanPhase({ ...fresh, foreman: { ...planned, firstRunAt: 'now' }, entitled: true, agentCount: 2 })).toBe('companion')
    })

    it('never pulls a working workspace into the funnel', () => {
        expect(foremanPhase({ ...fresh, entitled: true })).toBe('companion')
        expect(foremanPhase({ ...fresh, agentCount: 1 })).toBe('companion')
        expect(foremanPhase({ ...fresh, onboardingCompletedAt: '2026-01-01T00:00:00Z' })).toBe('companion')
    })

    it('walks a fresh workspace whose trial started outside the funnel through it', () => {
        expect(foremanPhase({ ...fresh, entitled: true, trialing: true })).toBe('discover')
        expect(foremanPhase({ ...fresh, foreman: profiled, entitled: true, trialing: true })).toBe('plan')
        expect(foremanPhase({ ...fresh, foreman: planned, entitled: true, trialing: true })).toBe('build')
        expect(foremanPhase({ ...fresh, entitled: true, trialing: true, agentCount: 1 })).toBe('companion')
        expect(foremanPhase({ ...fresh, entitled: true, trialing: true, onboardingCompletedAt: '2026-01-01T00:00:00Z' })).toBe('companion')
    })

    it('installs a ready-made link before asking who they are, then asks', () => {
        const linked = { ...fresh, arrivedReadyMade: true }
        const installing: ForemanProfile = { installedFirst: true, plan: { title: 'Acme', items: [{ kind: 'template', slug: 'seo-newsroom', title: 'SEO newsroom' }] } }
        expect(foremanPhase(linked)).toBe('plan')
        expect(foremanPhase({ ...linked, foreman: installing })).toBe('trial')
        expect(foremanPhase({ ...linked, foreman: installing, entitled: true })).toBe('build')
        expect(foremanPhase({ ...linked, foreman: { ...installing, firstRunAt: 'now' }, entitled: true, agentCount: 1 })).toBe('discover')
        expect(foremanPhase({ ...linked, foreman: { ...installing, firstRunAt: 'now', profileAt: 'now' }, entitled: true, agentCount: 1 })).toBe('companion')
    })

    it('ends the onboarding of a ready-made arrival whose welcome card was waived', () => {
        const waived: ForemanProfile = { installedFirst: false, firstRunAt: 'now', plan: { title: 'Acme', items: [{ kind: 'template', slug: 'seo-newsroom', title: 'SEO newsroom' }] } }
        expect(foremanPhase({ ...fresh, arrivedReadyMade: true, foreman: waived, entitled: true, agentCount: 1 })).toBe('companion')
    })

    it('keeps the welcome card first for a link nobody can read, and for a workspace already running', () => {
        expect(foremanPhase(fresh)).toBe('discover')
        expect(foremanPhase({ ...fresh, arrivedReadyMade: true, agentCount: 1 })).toBe('companion')
    })

    it('never sends a workspace built without the mark back to the welcome card', () => {
        expect(foremanPhase({ ...fresh, foreman: { plan: planned.plan, firstRunAt: 'then' }, entitled: true, agentCount: 1 })).toBe('companion')
    })

    it('does not rebuild the workspace of someone who deleted their last agent', () => {
        expect(foremanPhase({ ...fresh, foreman: { ...planned, firstRunAt: 'now' }, entitled: true, agentCount: 0 })).toBe('companion')
    })

    it('keeps a team agreed without a profile in the funnel once they pay', () => {
        const agreed: ForemanProfile = { plan: planned.plan }
        expect(foremanPhase({ ...fresh, foreman: agreed })).toBe('trial')
        expect(foremanPhase({ ...fresh, foreman: agreed, entitled: true })).toBe('build')
    })

    it('parks a funnel workspace on the waitlist while the pool is empty', () => {
        expect(foremanPhase({ ...fresh, waitlisted: true })).toBe('waitlist')
        expect(foremanPhase({ ...fresh, foreman: profiled, waitlisted: true })).toBe('waitlist')
        expect(foremanPhase({ ...fresh, foreman: planned, entitled: true, waitlisted: true })).toBe('waitlist')
    })

    it('never parks a workspace that is already running', () => {
        expect(foremanPhase({ ...fresh, agentCount: 1, waitlisted: true })).toBe('companion')
        expect(foremanPhase({ ...fresh, foreman: { ...planned, firstRunAt: 'now' }, entitled: true, agentCount: 0, waitlisted: true })).toBe('companion')
        expect(() => phaseSpec('waitlist')).toThrow()
    })

    it('has no hub turn to give once the onboarding is over', () => {
        expect(() => phaseSpec('companion')).toThrow()
    })
})

describe('phase specs', () => {
    it('keeps every phase within the onboarding belt', () => {
        const belt = new Set<string>(FOREMAN_TOOL_NAMES)
        for (const phase of Object.keys(PHASES) as ActiveForemanPhase[]) {
            expect(beltOf(phase).filter(name => !belt.has(name))).toEqual([])
        }
    })

    it('hands the build phase nothing at all', () => {
        expect([...beltOf('build')]).toEqual([])
    })

    it('lets every phase the model speaks in hand a stuck user to the team', () => {
        for (const phase of ['discover', 'plan', 'trial'] as const) {
            expect(beltOf(phase)).toContain('contact_team')
        }
    })

    it('never lets the model put the trial card up before the team exists', () => {
        for (const phase of ['discover', 'plan', 'trial', 'build'] as const) {
            expect(beltOf(phase)).not.toContain('open_checkout')
        }
    })

    it('hands no template tool to the plan phase unless a link brought one', () => {
        for (const tool of ['list_templates', 'show_templates', 'open_template_card'] as const) {
            expect(beltOf('plan')).not.toContain(tool)
            expect(beltOf('plan', { intent: { kind: 'prompt', text: 'copy Meta ads' } })).not.toContain(tool)
        }
        expect(beltOf('plan', { intent })).toContain('show_templates')
        expect(beltOf('plan', { intent: { kind: 'share', token: 'abc' } })).toContain('show_templates')
    })

    it('hands analyze_website to the plan phase only when the welcome card could not read the site', () => {
        expect(beltOf('plan', { answers: { company_url: 'https://acme-support.example', company_offering: 'AI support for merchants' } })).not.toContain('analyze_website')
        expect(beltOf('plan', { answers: { company_url: 'https://acme-support.example' } })).toContain('analyze_website')
        expect(beltOf('plan')).not.toContain('analyze_website')
    })

    it('only lets a plan hold what the conversation can really land', () => {
        expect(planKinds(stateOf('discover'))).toEqual(['agent'])
        expect(planKinds(stateOf('plan'))).toEqual(['agent'])
        expect(planKinds(stateOf('plan', { intent: { kind: 'prompt', text: 'triage my inbox' } }))).toEqual(['agent'])
        expect(planKinds(stateOf('plan', { intent }))).toEqual(['agent', 'template'])
        expect(planKinds(stateOf('plan', { intent: { kind: 'share', token: 'abc' } }))).toEqual(['agent', 'share'])
    })

    it('pins the Boxes of the welcome card, link or not', () => {
        expect(pinnedPlanBoxes(stateOf('plan', { answers: { industry: 'agencies' } }))).toEqual(intakeBoxes('agencies'))
        expect(pinnedPlanBoxes(stateOf('plan'))).toEqual(intakeBoxes(null))
        expect(pinnedPlanBoxes(stateOf('plan', { intent, answers: { industry: 'agencies' } }))).toEqual(intakeBoxes('agencies'))
        expect(pinnedPlanBoxes(stateOf('plan', { intent: { kind: 'share', token: 'abc' } }))).toEqual(intakeBoxes(null))
    })
})

describe('foremanUseCases', () => {
    it('reads the jobs they ticked, in the order they ticked them', () => {
        expect(foremanUseCases({ useCases: ['answer demo requests', 'write the weekly post'] })).toEqual(['answer demo requests', 'write the weekly post'])
    })

    it('answers a legacy profile with a list of one', () => {
        expect(foremanUseCases({ pain: 'answer demo requests' })).toEqual(['answer demo requests'])
    })

    it('answers nothing when nothing was said', () => {
        expect(foremanUseCases({})).toEqual([])
    })

    it('prefers the list when both are written', () => {
        expect(foremanUseCases({ useCases: ['write the weekly post', 'chase unpaid invoices'], pain: 'write the weekly post' })).toEqual(['write the weekly post', 'chase unpaid invoices'])
    })
})

describe('discover instructions', () => {
    it('asks the three fields and stops naming the ones already known', () => {
        const missing = (state: ForemanState) => PHASES.discover.instructions(state).split('\n').find(line => line.startsWith('Still missing:'))

        expect(missing(stateOf('discover'))).toBe('Still missing: the address of their company website, what they do there, their first name.')
        expect(missing(stateOf('discover', { firstName: 'Clément', answers: { position: 'Founder' } }))).toBe('Still missing: the address of their company website.')
    })

    it('never asks which job to hand over: the next step works it out', () => {
        const asked = PHASES.discover.instructions(stateOf('discover'))
        expect(asked).not.toContain('one ask_choice with multiple set')
        expect(asked).toContain('Do not ask them which job they want handed over')
    })
})

describe('plan instructions', () => {
    it('names the job they picked, and only that one', () => {
        const planning = PHASES.plan.instructions(stateOf('plan', { foreman: { useCases: ['answer demo requests'] } }))
        expect(planning).toContain('the job they named in the interview, answer demo requests')
        expect(planning).toContain('there is exactly one')
    })

    it('keeps to the first job of a profile that holds several', () => {
        const planning = PHASES.plan.instructions(stateOf('plan', { foreman: { useCases: ['answer demo requests', 'chase unpaid invoices'] } }))
        expect(planning).toContain('answer demo requests')
        expect(planning).not.toContain('chase unpaid invoices')
    })

    it('holds the card to one agent, whatever else they would need', () => {
        const planning = PHASES.plan.instructions(stateOf('plan'))
        expect(planning).toContain('One coworker and never a second')
        expect(planning).not.toContain('arrive switched off')
    })

    it('works the agent out itself when no job was picked', () => {
        const planning = PHASES.plan.instructions(stateOf('plan'))
        expect(planning).toContain('Nobody has named its job for you')
        expect(planning).toContain('never tell them you guessed')
    })

    it('lays the plan out in the Boxes already drawn on the board', () => {
        expect(PHASES.plan.instructions(stateOf('plan', { answers: { industry: 'saas' } }))).toContain(`in these Boxes: ${intakeBoxes('saas').join(', ')}.`)
        expect(PHASES.plan.instructions(stateOf('plan'))).toContain(`in these Boxes: ${intakeBoxes(null).join(', ')}.`)
    })

    it('lands a template link in one of the Boxes already drawn, without a plan card after it', () => {
        const planning = PHASES.plan.instructions(stateOf('plan', { intent, answers: { industry: 'saas' } }))
        expect(planning).toContain(`in these Boxes: ${intakeBoxes('saas').join(', ')}.`)
        expect(planning).toContain('Set `box` on show_templates to the one its work belongs to')
        expect(planning).not.toContain('read it back with show_plan in this same turn')
    })
})
