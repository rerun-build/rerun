import { describe, expect, it } from 'vitest'
import {
    accessEndsHelpMessage,
    accessEndsRecapMessage,
    paymentFailedMessage,
    teamLabel,
    trialAnythingBlockingMessage,
    trialFirstJobDoneMessage,
    trialIdeaForYouMessage,
    trialMorningReportMessage,
    trialNeedsYourOkMessage,
    trialNoFirstJobMessage,
    trialWeekRecapMessage,
    whatsappLanguage,
} from './templates'

const IMAGE = 'https://moldwright.robagentic.tech/og/board?scene=x'

describe('WhatsApp template builders', () => {
    it('fills the header image, the named body variables and the button path', () => {
        const message = accessEndsRecapMessage({ imageUrl: IMAGE, firstName: 'Lucien', taskCount: 14, path: '/w/acme?billing=1' })

        expect(message).toEqual({
            key: 'access_ends_recap',
            slug: 'rerun_access_ends_coworker',
            category: 'marketing',
            components: [
                { type: 'header', parameters: [{ type: 'image', url: IMAGE }] },
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', name: 'first_name', text: 'Lucien' },
                        { type: 'text', name: 'task_count', text: '14' },
                    ],
                },
                { type: 'button', parameters: [{ type: 'text', text: 'w/acme?billing=1&ref=whatsapp&wa=access_ends_recap' }] },
            ],
        })
    })

    it.each([
        [accessEndsRecapMessage({ imageUrl: IMAGE, firstName: 'L', taskCount: 14, path: 'w' }), 'rerun_access_ends_coworker', 'marketing', ['first_name', 'task_count'], true],
        [paymentFailedMessage({ imageUrl: IMAGE, team: 'A', path: 'w' }), 'rerun_payment_failed', 'utility', ['team'], true],
        [trialFirstJobDoneMessage({ imageUrl: IMAGE, firstName: 'L', result: 'r', path: 'w' }), 'rerun_trial_first_job_done', 'marketing', ['first_name', 'result'], true],
        [trialMorningReportMessage({ imageUrl: IMAGE, firstName: 'L', result: 'r', teaser: 't', path: 'w' }), 'rerun_trial_morning_report', 'marketing', ['first_name', 'result', 'teaser'], true],
        [trialNoFirstJobMessage({ imageUrl: IMAGE, firstName: 'L', coworker: 'c', path: 'w' }), 'rerun_trial_no_first_job', 'marketing', ['first_name', 'coworker'], true],
        [trialIdeaForYouMessage({ imageUrl: IMAGE, firstName: 'L', company: 'c', idea: 'i', path: 'w' }), 'rerun_trial_idea_for_you', 'marketing', ['first_name', 'company', 'idea'], true],
        [trialAnythingBlockingMessage({ imageUrl: IMAGE, firstName: 'L', lastDay: 'd', path: 'w' }), 'rerun_trial_anything_blocking', 'marketing', ['first_name', 'last_day'], true],
        [trialNeedsYourOkMessage({ imageUrl: IMAGE, firstName: 'L', action: 'a', path: 'w' }), 'rerun_trial_needs_your_ok', 'marketing', ['first_name', 'action'], true],
        [trialWeekRecapMessage({ imageUrl: IMAGE, firstName: 'L', taskCount: 9, path: 'w' }), 'rerun_trial_week_recap', 'marketing', ['first_name', 'task_count'], true],
    ])('declares what %o needs', (message, slug, category, names, hasImage) => {
        expect(message.slug).toBe(slug)
        expect(message.category).toBe(category)
        expect(message.components.some(component => component.type === 'header')).toBe(hasImage)
        expect(message.components.find(component => component.type === 'body')?.parameters.map(parameter => (parameter.type === 'text' ? parameter.name : null))).toEqual(names)
        expect(message.components.at(-1)).toEqual({ type: 'button', parameters: [{ type: 'text', text: `w?ref=whatsapp&wa=${message.key}` }] })
    })

    it('sends a template without variables with its image and its button alone', () => {
        expect(accessEndsHelpMessage({ imageUrl: IMAGE, path: 'w/acme' }).components).toEqual([
            { type: 'header', parameters: [{ type: 'image', url: IMAGE }] },
            { type: 'button', parameters: [{ type: 'text', text: 'w/acme?ref=whatsapp&wa=access_ends_help' }] },
        ])
    })

    it('writes a count as text', () => {
        expect(accessEndsRecapMessage({ imageUrl: IMAGE, firstName: 'L', taskCount: 14, path: 'w' }).components[1].parameters[1]).toEqual({ type: 'text', name: 'task_count', text: '14' })
    })

    it('greets someone without a first name with "Hey"', () => {
        expect(trialWeekRecapMessage({ imageUrl: IMAGE, firstName: null, taskCount: 9, path: 'w' }).components[1].parameters[0]).toEqual({ type: 'text', name: 'first_name', text: 'Hey' })
        expect(trialWeekRecapMessage({ imageUrl: IMAGE, firstName: '  ', taskCount: 9, path: 'w' }).components[1].parameters[0]).toEqual({ type: 'text', name: 'first_name', text: 'Hey' })
    })

    it('flattens the line breaks Meta refuses in a variable, and cuts a value that runs long', () => {
        const [team] = paymentFailedMessage({ imageUrl: IMAGE, team: `Lead\n\nScout   and\t${'x'.repeat(400)}`, path: 'w' }).components[1].parameters
        const text = team.type === 'text' ? team.text : ''

        expect(text.startsWith('Lead Scout and x')).toBe(true)
        expect(text).toHaveLength(300)
        expect(text.endsWith('…')).toBe(true)
    })
})

describe('teamLabel', () => {
    it.each([
        [[], 'your coworkers'],
        [['Lead Scout'], 'Lead Scout'],
        [['Lead Scout', 'Inbox Assistant'], 'Lead Scout and Inbox Assistant'],
        [['Lead Scout', 'Inbox Assistant', 'Meeting Booker'], 'Lead Scout, Inbox Assistant and 1 other'],
        [['Lead Scout', 'Inbox Assistant', 'Meeting Booker', 'Researcher'], 'Lead Scout, Inbox Assistant and 2 others'],
    ])('names %j as %s', (names, label) => {
        expect(teamLabel(names)).toBe(label)
    })
})

describe('whatsappLanguage', () => {
    it.each([
        ['fr', 'fr'],
        ['fr-BE', 'fr'],
        ['pt', 'pt-BR'],
        ['pt_PT', 'pt-BR'],
        ['en-US', 'en'],
        ['de', 'en'],
        [null, 'en'],
        [undefined, 'en'],
    ])('reads %s as %s', (locale, expected) => {
        expect(whatsappLanguage(locale)).toBe(expected)
    })
})
