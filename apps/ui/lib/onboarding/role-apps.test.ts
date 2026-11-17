import { INDUSTRY_ROLES, DEFAULT_ROLES, TEMPLATE_CATEGORIES } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { appsOfRole } from './role-apps'

describe('appsOfRole', () => {
    it('lights nothing before a role is said', () => {
        expect(appsOfRole('')).toEqual([])
        expect(appsOfRole('   ')).toEqual([])
    })

    it('reads the role from the words it holds, whatever the case', () => {
        expect(appsOfRole('Head of Growth')).toContain('linkedin')
        expect(appsOfRole('SALES MANAGER')).toContain('hubspot')
        expect(appsOfRole('Customer support lead')).toContain('intercom')
    })

    it('lights something for every role a tile offers', () => {
        const offered = new Set([...DEFAULT_ROLES, ...TEMPLATE_CATEGORIES.flatMap(category => INDUSTRY_ROLES[category] ?? [])])
        for (const role of offered) expect(appsOfRole(role), role).not.toEqual([])
    })

    it('lights nothing for a role it cannot read rather than guessing', () => {
        expect(appsOfRole('Astronaut')).toEqual([])
    })
})
