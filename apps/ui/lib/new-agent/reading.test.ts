import { describe, expect, it } from 'vitest'

import { EMPTY_READING, parseJobReading } from '@moldwright/ui/new-agent/reading'

const CATALOG = ['gmail', 'slack', 'hubspot', 'google-calendar', 'notion', 'stripe', 'linear']
const TEXT = 'Every morning, sort our hello@ inbox and tell us in Slack what needs us today'

describe('parseJobReading', () => {
    it('reads a plain JSON reply', () => {
        const reply = '{"name": "Inbox Triage", "apps": ["gmail", "slack"], "schedule": {"label": "Every morning", "source": "Every morning"}}'
        expect(parseJobReading(reply, TEXT, CATALOG)).toEqual({ name: 'Inbox Triage', apps: ['gmail', 'slack'], schedule: { label: 'Every morning', source: 'Every morning' } })
    })

    it('finds the JSON inside prose and a code fence', () => {
        const reply = 'Here you go:\n```json\n{"name": "Inbox Triage", "apps": [], "schedule": null}\n```'
        expect(parseJobReading(reply, TEXT, CATALOG)).toEqual({ name: 'Inbox Triage', apps: [], schedule: null })
    })

    it('drops the apps the catalogue does not carry and fixes the case of the others', () => {
        const reply = '{"name": "Lead Responder", "apps": ["HubSpot", "wordpress.com", "slack", "slack", 12]}'
        expect(parseJobReading(reply, TEXT, CATALOG).apps).toEqual(['hubspot', 'slack'])
    })

    it('keeps five apps at most', () => {
        const reply = JSON.stringify({ name: 'Everything', apps: CATALOG })
        expect(parseJobReading(reply, TEXT, CATALOG).apps).toHaveLength(5)
    })

    it('reads a blank name as no name', () => {
        expect(parseJobReading('{"name": "  ", "apps": []}', TEXT, CATALOG).name).toBeNull()
    })

    it('takes the source as the description spells it', () => {
        const reply = '{"name": null, "apps": [], "schedule": {"label": "Every morning at 9:00", "source": "every MORNING"}}'
        expect(parseJobReading(reply, TEXT, CATALOG).schedule).toEqual({ label: 'Every morning at 9:00', source: 'Every morning' })
    })

    it('keeps a timing whose source is not in the description, without a passage to underline', () => {
        const reply = '{"name": null, "apps": [], "schedule": {"label": "Daily", "source": "each day at dawn"}}'
        expect(parseJobReading(reply, TEXT, CATALOG).schedule).toEqual({ label: 'Daily', source: null })
    })

    it('reads a timing without a label as no timing', () => {
        expect(parseJobReading('{"name": null, "apps": [], "schedule": {"source": "Every morning"}}', TEXT, CATALOG).schedule).toBeNull()
    })

    it.each(['', 'I cannot help with that.', '{"name": ', '{"name": 4, "apps": "gmail"}', '[]'])('reads %j as nothing', reply => {
        expect(parseJobReading(reply, TEXT, CATALOG)).toEqual(EMPTY_READING)
    })
})
