import { describe, expect, it } from 'vitest'

import { internalPath } from './internal-path'

describe('internalPath', () => {
    it('keeps a path of this host, with its query and hash', () => {
        expect(internalPath('/about?x=1#top', '/')).toBe('/about?x=1#top')
        expect(internalPath('/invite/abc', '/')).toBe('/invite/abc')
        expect(internalPath('/', '/home')).toBe('/')
    })

    it('falls back on anything that could leave the host', () => {
        for (const raw of ['https://evil.example', 'http://evil.example/', '//evil.example', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)', 'evil.example', 'about', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/ /evil.example', '/%0a/evil.example?x=\u0000']) {
            expect(internalPath(raw, '/fallback'), raw).toBe('/fallback')
        }
    })

    it('falls back when nothing was asked', () => {
        expect(internalPath(null, '/fallback')).toBe('/fallback')
        expect(internalPath(undefined, '/fallback')).toBe('/fallback')
        expect(internalPath('', '/fallback')).toBe('/fallback')
    })
})
