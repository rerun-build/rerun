import { FOREMAN_AGENT_ID } from '@rerun/contracts'
import { hashedBuddyLook } from '@rerun/ui/iso-grid/buddy-look'
import { describe, expect, it } from 'vitest'

import { coworkerPortraitUrl, portraitOfSlug } from './coworker-portrait'

const slugOf = (url: string) => new URL(url).pathname.split('/').at(-1) ?? ''

describe('coworkerPortraitUrl', () => {
    it('names the look a coworker was given, and reads it back', () => {
        const look = { eyes: 'heart', mouth: 'cat', color: '#f0127f', material: 'knit' } as const
        expect(portraitOfSlug(slugOf(coworkerPortraitUrl('agent-1', look)))).toEqual({ kind: 'buddy', look })
    })

    it('carries a colour picked freely, in lower case', () => {
        const look = { eyes: 'pill', mouth: 'none', color: '#FF7A00', material: 'fluffy' } as const
        expect(portraitOfSlug(slugOf(coworkerPortraitUrl('agent-1', look)))).toEqual({ kind: 'buddy', look: { ...look, color: '#ff7a00' } })
    })

    it('draws a coworker nobody dressed with the look hashed from its id, in the classic block', () => {
        const id = 'b4d2f6d0-5a3c-4c0e-9a43-0d8a7f6f2c11'
        expect(portraitOfSlug(slugOf(coworkerPortraitUrl(id, null)))).toEqual({ kind: 'buddy', look: { ...hashedBuddyLook(id), material: 'classic' } })
    })

    it('carries neither the id nor anything else than a look', () => {
        expect(coworkerPortraitUrl('secret-agent-id', null)).not.toContain('secret')
    })

    it('gives the Chief of Staff its orb', () => {
        expect(portraitOfSlug(slugOf(coworkerPortraitUrl(FOREMAN_AGENT_ID, null)))).toEqual({ kind: 'foreman' })
    })
})

describe('portraitOfSlug', () => {
    it.each(['', 'pill', 'pill-smile-0f52ff', 'pill-smile-0f52ff-marble', 'pill-smile-orange-classic', 'pill-smile-FF7A00-classic', 'pill-smile-ff7a0-classic', 'pill-smile-0f52ff-classic-extra', '../board'])('refuses %j', slug => {
        expect(portraitOfSlug(slug)).toBeNull()
    })
})
