import { afterEach, describe, expect, it, vi } from 'vitest'

const edition = vi.hoisted(() => ({ cloud: true }))
vi.mock('@/cloud/edition', () => ({
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

    // The funnel is for a first arrival. Everyone already running was, before this existed, talking
    // to the companion, and must keep talking to it.
    it('never pulls a working workspace into the funnel', () => {
        expect(foremanPhase({ ...fresh, entitled: true })).toBe('companion')
        expect(foremanPhase({ ...fresh, agentCount: 1 })).toBe('companion')
        expect(foremanPhase({ ...fresh, onboardingCompletedAt: '2026-01-01T00:00:00Z' })).toBe('companion')
    })

    // A trial started from a paywall the Foreman never showed (Upgrade, an AI provider, API keys)
    // leaves a fresh workspace entitled before its first question: it still has a team to build.
    it('walks a fresh workspace whose trial started outside the funnel through it', () => {
        expect(foremanPhase({ ...fresh, entitled: true, trialing: true })).toBe('discover')
        expect(foremanPhase({ ...fresh, foreman: profiled, entitled: true, trialing: true })).toBe('plan')
        expect(foremanPhase({ ...fresh, foreman: planned, entitled: true, trialing: true })).toBe('build')
        expect(foremanPhase({ ...fresh, entitled: true, trialing: true, agentCount: 1 })).toBe('companion')
        expect(foremanPhase({ ...fresh, entitled: true, trialing: true, onboardingCompletedAt: '2026-01-01T00:00:00Z' })).toBe('companion')
    })

    // What they clicked is installed first and the welcome card waits behind the build: nothing
    // stands between the link and the coworker but an account and a trial.
    it('installs a ready-made link before asking who they are, then asks', () => {
        const linked = { ...fresh, arrivedReadyMade: true }
        const installing: ForemanProfile = { installedFirst: true, plan: { title: 'Acme', items: [{ kind: 'template', slug: 'seo-newsroom', title: 'SEO newsroom' }] } }
        expect(foremanPhase(linked)).toBe('plan')
        expect(foremanPhase({ ...linked, foreman: installing })).toBe('trial')
        expect(foremanPhase({ ...linked, foreman: installing, entitled: true })).toBe('build')
        expect(foremanPhase({ ...linked, foreman: { ...installing, firstRunAt: 'now' }, entitled: true, agentCount: 1 })).toBe('discover')
        expect(foremanPhase({ ...linked, foreman: { ...installing, firstRunAt: 'now', profileAt: 'now' }, entitled: true, agentCount: 1 })).toBe('companion')
    })

    // On a phone the card has no room beside the coworker's chat: the mark is taken back instead.
    it('ends the onboarding of a ready-made arrival whose welcome card was waived', () => {
        const waived: ForemanProfile = { installedFirst: false, firstRunAt: 'now', plan: { title: 'Acme', items: [{ kind: 'template', slug: 'seo-newsroom', title: 'SEO newsroom' }] } }
        expect(foremanPhase({ ...fresh, arrivedReadyMade: true, foreman: waived, entitled: true, agentCount: 1 })).toBe('companion')
    })

    it('keeps the welcome card first for a link nobody can read, and for a workspace already running', () => {
        expect(foremanPhase(fresh)).toBe('discover')
        expect(foremanPhase({ ...fresh, arrivedReadyMade: true, agentCount: 1 })).toBe('companion')
    })

    // Rows built before the mark existed can hold a first run and no profile: they are companions.
    it('never sends a workspace built without the mark back to the welcome card', () => {
        expect(foremanPhase({ ...fresh, foreman: { plan: planned.plan, firstRunAt: 'then' }, entitled: true, agentCount: 1 })).toBe('companion')
    })

    it('does not rebuild the workspace of someone who deleted their last agent', () => {
        expect(foremanPhase({ ...fresh, foreman: { ...planned, firstRunAt: 'now' }, entitled: true, agentCount: 0 })).toBe('companion')
    })

    // The trap this ordering exists for: a conversation that agreed a team without ever writing a
    // profile, so keying the funnel on the profile alone would drop it at its own checkout, one step
    // before the build.
    it('keeps a team agreed without a profile in the funnel once they pay', () => {
        const agreed: ForemanProfile = { plan: planned.plan }
        expect(foremanPhase({ ...fresh, foreman: agreed })).toBe('trial')
        expect(foremanPhase({ ...fresh, foreman: agreed, entitled: true })).toBe('build')
    })

    // An empty pool stops the funnel wherever it stands, before the welcome card included: the
    // plan and the trial are tokens spent on a team that has nowhere to run.
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

    // The onboarding is the hub's and nothing past it: a companion talks to the foreman on its engine.
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

    // The app builds the team itself: the model is never handed a turn in the build phase.
    it('hands the build phase nothing at all', () => {
        expect([...beltOf('build')]).toEqual([])
    })

    // Someone stuck anywhere in the funnel has to be able to reach a person, not only at the trial.
    it('lets every phase the model speaks in hand a stuck user to the team', () => {
        for (const phase of ['discover', 'plan', 'trial'] as const) {
            expect(beltOf(phase)).toContain('contact_team')
        }
    })

    // The trial card is the app's to put up: the model only answers what the user said around it.
    it('never lets the model put the trial card up before the team exists', () => {
        for (const phase of ['discover', 'plan', 'trial', 'build'] as const) {
            expect(beltOf(phase)).not.toContain('open_checkout')
        }
    })

    // The team is designed, never picked from a catalog. A template card only exists for someone
    // who clicked one before signing up.
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

    // The same rule as the belt, one layer down: the team is designed, so the only shape a plan item
    // has is an agent. A template item is what would hand install_template back to the build phase.
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

// The discovery card hands back a list, and the profiles already written hold a single string. Both
// shapes are alive at the same time, so everything downstream reads them through one door.
describe('foremanUseCases', () => {
    it('reads the jobs they ticked, in the order they ticked them', () => {
        expect(foremanUseCases({ useCases: ['answer demo requests', 'write the weekly post'] })).toEqual(['answer demo requests', 'write the weekly post'])
    })

    // A profile written before the multiple selection, which is every profile in production today.
    it('answers a legacy profile with a list of one', () => {
        expect(foremanUseCases({ pain: 'answer demo requests' })).toEqual(['answer demo requests'])
    })

    it('answers nothing when nothing was said', () => {
        expect(foremanUseCases({})).toEqual([])
    })

    // save_profile writes both, the list and its first entry, so a profile carrying the two is the
    // normal case rather than the odd one: the list is the one that counts.
    it('prefers the list when both are written', () => {
        expect(foremanUseCases({ useCases: ['write the weekly post', 'chase unpaid invoices'], pain: 'write the weekly post' })).toEqual(['write the weekly post', 'chase unpaid invoices'])
    })
})

describe('discover instructions', () => {
    // Le tunnel normal ne passe plus par là : la carte d'accueil pose les trois questions avant que
    // le modèle ne soit appelé. Il reste la phase de repli, et elle doit tenir le même budget.
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
    // The plan is no longer the model's idea of a good agent: it is the job they picked, named back
    // to them. Naming it in the prompt is what keeps an agent nobody asked for out of the card.
    it('names the job they picked, and only that one', () => {
        const planning = PHASES.plan.instructions(stateOf('plan', { foreman: { useCases: ['answer demo requests'] } }))
        expect(planning).toContain('the job they named in the interview, answer demo requests')
        expect(planning).toContain('there is exactly one')
    })

    // A profile written when the interview still took several jobs: the first one is the agent.
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

    // Le cas d'un profil passé à côté de l'interview : personne n'a nommé le job, il se déduit de
    // l'entreprise et du rôle. Le prompt doit le dire, sinon le modèle demande une liste qui
    // n'existe plus.
    it('works the agent out itself when no job was picked', () => {
        const planning = PHASES.plan.instructions(stateOf('plan'))
        expect(planning).toContain('Nobody has named its job for you')
        expect(planning).toContain('never tell them you guessed')
    })

    // L'esquisse que la carte a dessinée pendant qu'on la remplissait : la contredire referait tout
    // le board sous les yeux de quelqu'un qui n'a encore rien validé.
    it('lays the plan out in the Boxes already drawn on the board', () => {
        expect(PHASES.plan.instructions(stateOf('plan', { answers: { industry: 'saas' } }))).toContain(`in these Boxes: ${intakeBoxes('saas').join(', ')}.`)
        expect(PHASES.plan.instructions(stateOf('plan'))).toContain(`in these Boxes: ${intakeBoxes(null).join(', ')}.`)
    })

    // Un lien de template atterrit dans l'une des Box dessinées, les autres restent sur le board.
    it('lands a template link in one of the Boxes already drawn, without a plan card after it', () => {
        const planning = PHASES.plan.instructions(stateOf('plan', { intent, answers: { industry: 'saas' } }))
        expect(planning).toContain(`in these Boxes: ${intakeBoxes('saas').join(', ')}.`)
        expect(planning).toContain('Set `box` on show_templates to the one its work belongs to')
        expect(planning).not.toContain('read it back with show_plan in this same turn')
    })
})
