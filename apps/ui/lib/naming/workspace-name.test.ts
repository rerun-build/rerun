import { describe, expect, it } from 'vitest'

import { asTitle, DEFAULT_WORKSPACE_NAME, possessive, workspaceNameFrom, WORKSPACE_NAME_MAX } from './workspace-name'

describe('possessive', () => {
    it('adds an apostrophe alone after a name ending in s', () => {
        expect(possessive('Jonas')).toBe("Jonas'")
        expect(possessive('Lucas')).toBe("Lucas'")
    })

    it('adds an apostrophe s otherwise', () => {
        expect(possessive('Clément')).toBe("Clément's")
    })
})

describe('workspaceNameFrom', () => {
    it('takes the company read off the website first', () => {
        expect(workspaceNameFrom({ companyName: 'Acme', firstName: 'Clément' })).toBe('Acme')
    })

    it('falls back to the first name when there is no company', () => {
        expect(workspaceNameFrom({ firstName: 'Clément' })).toBe("Clément's workspace")
        expect(workspaceNameFrom({ firstName: 'jihane' })).toBe("Jihane's workspace")
    })

    it('ignores a blank company name', () => {
        expect(workspaceNameFrom({ companyName: '   ', firstName: 'Clément' })).toBe("Clément's workspace")
    })

    it('keeps the default when nothing is known', () => {
        expect(workspaceNameFrom({})).toBe(DEFAULT_WORKSPACE_NAME)
        expect(workspaceNameFrom({ companyName: null, firstName: null })).toBe(DEFAULT_WORKSPACE_NAME)
    })

    it('caps a name the pill could not show', () => {
        const name = workspaceNameFrom({ companyName: 'A'.repeat(200) })
        expect(name).toHaveLength(WORKSPACE_NAME_MAX)
    })
})

describe('asTitle', () => {
    it('raises the initial of a name typed in lower case', () => {
        expect(asTitle('jihane')).toBe('Jihane')
        expect(asTitle('Clément')).toBe('Clément')
        expect(asTitle('')).toBe('')
    })
})
