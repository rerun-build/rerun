import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { brandCss } from './css'

const agency = (color: string | null): Brand => ({ ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', color })

describe('brandCss', () => {
    it('writes nothing for Rerun', () => {
        expect(brandCss(RERUN_BRAND)).toBe('')
        expect(brandCss({ ...RERUN_BRAND, color: '#ff0000' })).toBe('')
    })

    it('writes each theme on the root and on an island of it', () => {
        const css = brandCss(agency('#1668e3'))
        expect(css).toContain('html:root,html .light{--brand:#1668e3;')
        expect(css).toContain('html:root.dark,html .dark{--brand:')
        expect(css).toContain('--bubble-ink:#ffffff')
    })

    it('is neutral without a color', () => {
        expect(brandCss(agency(null))).toContain('html:root,html .light{--brand:#171717;')
    })

    it.each(['#fff}</style><script>alert(1)</script>', 'red;}body{display:none', 'url(https://example.com)', '#12345', '</style>', '#1668e3;'])('never writes what is not a hex color: %s', color => {
        expect(brandCss(agency(color))).toBe(brandCss(agency(null)))
    })

    it('holds nothing but hex values', () => {
        const values = [...brandCss(agency('#F97316')).matchAll(/--[a-z-]+:([^;}]+)/g)].map(match => match[1])
        expect(values).toHaveLength(22)
        for (const value of values) expect(value).toMatch(/^#[0-9a-f]{6}$/)
    })
})
