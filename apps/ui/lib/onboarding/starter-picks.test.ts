import { describe, expect, it } from 'vitest'

import { readStarterPicks, serializeStarterPicks, stripStarterPicks } from '@rerun/contracts'

describe('starter picks', () => {
    it('round-trips the slugs and keeps the sentence for people', () => {
        const text = serializeStarterPicks(['crm-pipeline', 'inbox-triage'], 'Set up Scout and Ledger.')
        expect(readStarterPicks(text)).toEqual(['crm-pipeline', 'inbox-triage'])
        expect(stripStarterPicks(text)).toBe('Set up Scout and Ledger.')
    })

    it('leaves any other message alone', () => {
        expect(readStarterPicks('Hello')).toBeNull()
        expect(stripStarterPicks('Hello\nthere')).toBe('Hello\nthere')
    })
})
