import { describe, expect, it } from 'vitest'

import { reachableChannels } from './reach'

describe('reachableChannels', () => {
    it('keeps both channels, WhatsApp first, where nothing is refused', () => {
        expect(reachableChannels('FR', 'verify')).toEqual(['whatsapp', 'sms'])
        expect(reachableChannels('FR', 'rerun')).toEqual(['whatsapp', 'sms'])
    })

    it('drops WhatsApp for codes where Bird Verify cannot carry them, not for Rerun’s own number', () => {
        expect(reachableChannels('IN', 'verify')).toEqual(['sms'])
        expect(reachableChannels('IN', 'rerun')).toEqual(['whatsapp', 'sms'])
    })

    it('drops WhatsApp for Rerun’s own number where Meta keeps it out, not for codes', () => {
        expect(reachableChannels('BR', 'rerun')).toEqual(['sms'])
        expect(reachableChannels('BR', 'rerun_marketing')).toEqual(['sms'])
        expect(reachableChannels('BR', 'verify')).toEqual(['whatsapp', 'sms'])
    })

    it('drops WhatsApp for a marketing template to the US, not for a utility one nor for Canada', () => {
        expect(reachableChannels('US', 'rerun_marketing')).toEqual(['sms'])
        expect(reachableChannels('US', 'rerun')).toEqual(['whatsapp', 'sms'])
        expect(reachableChannels('CA', 'rerun_marketing')).toEqual(['whatsapp', 'sms'])
    })

    it('leaves China no channel at all', () => {
        expect(reachableChannels('CN', 'verify')).toEqual([])
        expect(reachableChannels('CN', 'rerun')).toEqual([])
    })

    it('leaves Saudi Arabia no channel for codes, keeps Rerun’s own WhatsApp', () => {
        expect(reachableChannels('SA', 'verify')).toEqual([])
        expect(reachableChannels('SA', 'rerun')).toEqual(['whatsapp', 'sms'])
    })

    it('keeps both channels when the country is unknown', () => {
        expect(reachableChannels(undefined, 'verify')).toEqual(['whatsapp', 'sms'])
    })
})
