import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'
import { brandDocsUrl, brandTerms } from './links'

const agency = (links: Partial<Brand['links']> = {}): Brand => ({ ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', links: { docs: null, terms: null, privacy: null, ...links } })

describe('brand links', () => {
    it('keeps the pages of Rerun', () => {
        expect(brandDocsUrl(RERUN_BRAND)).toBe('https://docs.rerun.build')
        expect(brandTerms(RERUN_BRAND)).toEqual({ terms: expect.stringMatching(/\/terms$/), privacy: expect.stringMatching(/\/privacy$/) })
    })

    it('never sends the client of an organization to a page of Rerun', () => {
        expect(brandDocsUrl(agency())).toBeNull()
        expect(brandTerms(agency())).toBeNull()
        expect(brandTerms(agency({ terms: 'https://nordlys.example/terms' }))).toBeNull()
    })

    it('links the pages of the organization', () => {
        expect(brandDocsUrl(agency({ docs: 'https://help.nordlys.example' }))).toBe('https://help.nordlys.example')
        expect(brandTerms(agency({ terms: 'https://n.example/t', privacy: 'https://n.example/p' }))).toEqual({ terms: 'https://n.example/t', privacy: 'https://n.example/p' })
    })
})
