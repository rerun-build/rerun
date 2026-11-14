import { describe, expect, it } from 'vitest'

import { faviconUrl, siteDomain } from './site-favicon'

describe('siteDomain', () => {
    it('reads an address out of whatever form it was typed in', () => {
        expect(siteDomain('acme.com')).toBe('acme.com')
        expect(siteDomain('  ACME.com  ')).toBe('acme.com')
        expect(siteDomain('www.acme.com')).toBe('acme.com')
        expect(siteDomain('https://www.acme.com/pricing?ref=x')).toBe('acme.com')
        expect(siteDomain('http://acme.co.uk')).toBe('acme.co.uk')
        expect(siteDomain('acme.com.')).toBe('acme.com')
        expect(siteDomain('blog.acme.io')).toBe('blog.acme.io')
    })

    it('says nothing while the address is still being typed', () => {
        expect(siteDomain('')).toBeNull()
        expect(siteDomain('acme')).toBeNull()
        expect(siteDomain('acme.')).toBeNull()
        expect(siteDomain('acme.c')).toBeNull()
        expect(siteDomain('.com')).toBeNull()
        expect(siteDomain('acme corp')).toBeNull()
        expect(siteDomain('localhost')).toBeNull()
        expect(siteDomain('https://')).toBeNull()
    })

    it('punycodes an international name, which is what the favicon service is keyed on', () => {
        expect(siteDomain('café.fr')).toBe('xn--caf-dma.fr')
    })
})

describe('faviconUrl', () => {
    it('asks for a size the tile can downscale', () => {
        expect(faviconUrl('acme.com')).toBe('https://www.google.com/s2/favicons?sz=128&domain=acme.com')
    })
})
