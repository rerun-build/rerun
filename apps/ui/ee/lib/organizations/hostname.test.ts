import { describe, expect, it } from 'vitest'

import { isReservedHostname, normalizeHostname } from './hostname'

describe('normalizeHostname', () => {
    it.each([
        ['app.acme.com', 'app.acme.com'],
        ['  App.ACME.com ', 'app.acme.com'],
        ['app.acme.com.', 'app.acme.com'],
        ['café.example', 'xn--caf-dma.example'],
        ['xn--caf-dma.example', 'xn--caf-dma.example'],
        ['app.例え.テスト', 'app.xn--r8jz45g.xn--zckzah'],
        ['a--b.acme.com', 'a--b.acme.com'],
    ])('spells %j as DNS does', (raw, hostname) => {
        expect(normalizeHostname(raw)).toBe(hostname)
    })

    it.each([
        '',
        '   ',
        'acme',
        'localhost',
        'https://app.acme.com',
        'app.acme.com/path',
        'app.acme.com:8443',
        'app.acme.com?x=1',
        'app.acme.com#x',
        'user@app.acme.com',
        'user:pass@app.acme.com',
        'app.acme.com\\evil.com',
        'app acme.com',
        'app.acme.com\nevil.com',
        'app.acme.com\u0000',
        '%61pp.acme.com',
        '*.acme.com',
        'app..acme.com',
        '.acme.com',
        '-app.acme.com',
        'app-.acme.com',
        'app_1.acme.com',
        'app.acme.c',
        'app.acme.123',
        '203.0.113.7',
        '0x7f.0.0.1',
        '2130706433',
        '127.1',
        '[::1]',
        '::1',
        `${'a'.repeat(64)}.acme.com`,
        `${'a.'.repeat(130)}com`,
    ])('refuses %j', raw => {
        expect(normalizeHostname(raw)).toBeNull()
    })
})

describe('isReservedHostname', () => {
    const own = ['rerun.work', 'rerun.site', null, 'app.rerun.build']

    it.each(['rerun.build', 'app.rerun.build', 'x.rerun.site', 'rerun.work', 'nordlys.rerun.work', 'rerun.com', 'login.rerun.io'])('keeps %s', hostname => {
        expect(isReservedHostname(hostname, own)).toBe(true)
    })

    it.each(['acme.com', 'rerun.acme.com', 'notrerun.build', 'rerunning.com', 'rerun.work.acme.com'])('lets %s go', hostname => {
        expect(isReservedHostname(hostname, own)).toBe(false)
    })
})
