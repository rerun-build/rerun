import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { foremanNextSteps, trialStep } from './next-steps'
import { englishTranslator } from '@/lib/i18n/english-translator'

const t = englishTranslator('foreman.nextSteps')

function assistant(...parts: unknown[]): UIMessage {
    return { id: 'a', role: 'assistant', parts } as UIMessage
}

function user(text: string): UIMessage {
    return { id: 'u', role: 'user', parts: [{ type: 'text', text }] } as UIMessage
}

const agent = (id: string, patch: Record<string, unknown> = {}) => ({ agentId: id, name: id, boxId: 'box', active: true, lead: true, ...patch })
const build = (agents: unknown[]) => ({ type: 'tool-build_team', toolCallId: 'build-1', state: 'output-available', input: {}, output: { boxes: [], agents, failed: [] } })

const labels = (messages: UIMessage[]) => foremanNextSteps(messages, { entitled: true, t }).map(step => step.label)

describe('foremanNextSteps', () => {
    const waiting = (id: string, patch: Record<string, unknown> = {}) => agent(id, { lead: undefined, ...patch })

    it('hands over one button: the one that starts the agent', () => {
        const steps = foremanNextSteps([assistant(build([agent('closer')]))], { entitled: true, t })
        expect(steps).toEqual([{ kind: 'start_lead', label: 'Start installing closer', startedLabel: "closer's install has started", agentId: 'closer' }])
    })

    // A template that installs several agents: the first one starts, the others wait on their own
    // install button.
    it('starts the first agent of a template that brought several', () => {
        const messages = [assistant(build([agent('closer'), waiting('writer'), waiting('insights', { active: false })]))]
        expect(labels(messages)).toEqual(['Start installing closer'])
    })

    it('names the coworker generically when the build did not', () => {
        const [step] = foremanNextSteps([assistant(build([agent('closer', { name: undefined })]))], { entitled: true, t })
        expect(step).toMatchObject({ label: 'Start installing my coworker', startedLabel: "Your coworker's install has started" })
    })

    it('offers the slot instead of a start for an agent left without one', () => {
        const messages = [assistant(build([agent('closer', { active: false })]))]
        expect(foremanNextSteps(messages, { entitled: true, t })).toEqual([{ kind: 'billing', label: 'Turn on my coworker' }])
    })

    it('goes away as soon as anything is said after the build', () => {
        expect(foremanNextSteps([assistant(build([agent('closer')])), user('What does it cost after the trial?')], { entitled: true, t })).toEqual([])
    })

    it('offers nothing for a build that landed no agent', () => {
        expect(foremanNextSteps([assistant(build([]))], { entitled: true, t })).toEqual([])
    })

    it('offers nothing on an empty conversation', () => {
        expect(foremanNextSteps([], { entitled: true, t })).toEqual([])
    })

    describe('past the trial card', () => {
        const checkout = (output?: unknown) => ({ type: 'tool-open_checkout', toolCallId: 'trial-1', state: output === undefined ? 'input-available' : 'output-available', input: {}, output })
        const dismissed = checkout({ ok: false, reason: 'dismissed' })
        const reply = assistant({ type: 'text', text: 'The button right below starts your trial.' })
        const preTrial = (messages: UIMessage[]) => foremanNextSteps(messages, { entitled: false, t })

        it('puts the trial back under the foreman answer to a card they typed over', () => {
            expect(preTrial([assistant(dismissed), user('Und nun?'), reply])).toEqual([{ kind: 'checkout', label: 'Start free trial', trigger: 'foreman' }])
        })

        it('offers the plan instead when their card already had its trial', () => {
            expect(preTrial([assistant(checkout({ ok: false, reason: 'trial_refused' })), user('Why?'), reply])).toEqual([{ kind: 'checkout', label: 'Start my plan', trigger: 'trial_refused' }])
        })

        it('offers nothing once the workspace is on a plan', () => {
            expect(foremanNextSteps([assistant(dismissed), user('Und nun?'), reply], { entitled: true, t })).toEqual([])
        })

        it('leaves the card to itself while it is the last thing said', () => {
            expect(preTrial([assistant(checkout())])).toEqual([])
            expect(preTrial([assistant(dismissed)])).toEqual([])
        })

        it('offers nothing while the foreman is still being asked', () => {
            expect(preTrial([assistant(dismissed), user('Und nun?')])).toEqual([])
        })

        it('stays out of the way of a question the foreman left open', () => {
            const question = { type: 'tool-ask_choice', toolCallId: 'ask-1', state: 'input-available', input: { question: 'Which?', options: ['A', 'B'] } }
            expect(preTrial([assistant(dismissed), user('Und nun?'), assistant({ type: 'text', text: 'Which one?' }, question)])).toEqual([])
        })

        it('offers nothing once the trial started or the team was built', () => {
            expect(preTrial([assistant(checkout({ ok: true, status: 'entitled' })), user('Thanks'), reply])).toEqual([])
            expect(preTrial([assistant(dismissed), assistant(build([])), user('And now?'), reply])).toEqual([])
        })
    })
})

describe('trialStep', () => {
    const checkout = (output?: unknown) => ({ type: 'tool-open_checkout', toolCallId: 'trial-1', state: output === undefined ? 'input-available' : 'output-available', input: {}, output })
    const step = (messages: UIMessage[], entitled = false) => trialStep(messages, { entitled })

    it('is nothing before the trial card went up', () => {
        expect(step([])).toBeNull()
        expect(step([user('Hi'), assistant({ type: 'text', text: 'Hello' })])).toBeNull()
    })

    it('holds while the card waits and once it came back without a plan', () => {
        expect(step([assistant(checkout())])).toBe('trial')
        expect(step([assistant(checkout({ ok: false, reason: 'dismissed' })), assistant({ type: 'text', text: 'The button below.' })])).toBe('trial')
        expect(step([assistant(checkout({ ok: false, reason: 'pending' }))])).toBe('trial')
    })

    it('asks for the plan when their card already had its trial', () => {
        expect(step([assistant(checkout({ ok: false, reason: 'trial_refused' }))])).toBe('trial_refused')
    })

    it('lets go once the workspace is on a plan or the team was built', () => {
        expect(step([assistant(checkout())], true)).toBeNull()
        expect(step([assistant(checkout({ ok: true, status: 'entitled' }))])).toBeNull()
        expect(step([assistant(checkout({ ok: false, reason: 'dismissed' })), assistant(build([]))])).toBeNull()
    })
})
