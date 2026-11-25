import { RERUN_BRAND, engineBrandOf } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { brandContact, brandDiscretion, brandText, brandTools } from './text'

const NORDLYS = { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', supportEmail: 'help@nordlys.example' }

const TOOL = {
    name: 'rerun_hub_search_docs',
    description: 'Search the Rerun documentation (https://docs.rerun.build) of Rerun.',
    inputSchema: { type: 'object', properties: { description: { type: 'string', description: 'A Rerun word.' }, pick: { enum: ['Rerun'] } } },
}

describe('a text under a brand', () => {
    it('is left as it is for Rerun', () => {
        expect(brandText('Rerun and docs.rerun.build (docs.rerun.build)', RERUN_BRAND)).toBe('Rerun and docs.rerun.build (docs.rerun.build)')
        expect(brandTools([TOOL], RERUN_BRAND)[0]).toBe(TOOL)
        expect(brandDiscretion(RERUN_BRAND)).toBe('')
        expect(engineBrandOf({ ...RERUN_BRAND, supportEmail: 'x@y.z' })).toEqual({ name: 'Rerun', whiteLabel: false, supportEmail: null })
    })

    it('names the organization in what a tool says, never in what it is', () => {
        expect(brandTools([TOOL], NORDLYS)).toEqual([
            {
                name: 'rerun_hub_search_docs',
                description: 'Search the Nordlys documentation of Nordlys.',
                inputSchema: { type: 'object', properties: { description: { type: 'string', description: 'A Nordlys word.' }, pick: { enum: ['Rerun'] } } },
            },
        ])
    })

    it('sends to the support of the organization, with an address or without', () => {
        expect(brandContact(NORDLYS)).toBe('help@nordlys.example')
        expect(brandContact({ ...NORDLYS, supportEmail: null })).not.toMatch(/rerun/i)
        expect(brandDiscretion(NORDLYS)).toContain('help@nordlys.example')
        expect(brandDiscretion({ ...NORDLYS, supportEmail: null })).toContain('whoever gave them this workspace')
    })
})
