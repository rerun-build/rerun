import { APP_GATED_PATHS, LANDING_GATED_PATHS, brandGateVerdict, isGatedPath } from '@moldwright/contracts'
import { describe, expect, it } from 'vitest'

const SECRET = 'kit-token'

describe('brandGateVerdict', () => {
    it('opens everything on a dev server, even without a token configured', () => {
        expect(brandGateVerdict({ secret: undefined, param: null, cookie: undefined, production: false })).toBe('open')
    })

    it('denies a deployed host that has no token configured, even to a matching empty key', () => {
        expect(brandGateVerdict({ secret: undefined, param: undefined, cookie: undefined, production: true })).toBe('deny')
        expect(brandGateVerdict({ secret: '', param: '', cookie: '', production: true })).toBe('deny')
    })

    it('grants a first visit carrying the right key', () => {
        expect(brandGateVerdict({ secret: SECRET, param: SECRET, cookie: undefined, production: true })).toBe('grant')
    })

    it('opens a return visit carrying the cookie', () => {
        expect(brandGateVerdict({ secret: SECRET, param: null, cookie: SECRET, production: true })).toBe('open')
    })

    it('denies a wrong key and a wrong cookie', () => {
        expect(brandGateVerdict({ secret: SECRET, param: 'guess', cookie: undefined, production: true })).toBe('deny')
        expect(brandGateVerdict({ secret: SECRET, param: null, cookie: 'guess', production: true })).toBe('deny')
    })

    it('falls back to a valid cookie when the key is wrong', () => {
        expect(brandGateVerdict({ secret: SECRET, param: 'guess', cookie: SECRET, production: true })).toBe('open')
    })
})

describe('isGatedPath', () => {
    it('gates the labs of the app and everything under them, and leaves the UI kit open', () => {
        expect(isGatedPath('/render/lab', APP_GATED_PATHS)).toBe(true)
        expect(isGatedPath('/render/lab/buttons', APP_GATED_PATHS)).toBe(true)
        expect(isGatedPath('/render/kit', APP_GATED_PATHS)).toBe(false)
    })

    it('leaves a sibling path sharing the prefix open', () => {
        expect(isGatedPath('/render/labels', APP_GATED_PATHS)).toBe(false)
        expect(isGatedPath('/render/brand/og', APP_GATED_PATHS)).toBe(false)
    })

    it('gates the preview labs of the landing, and leaves the brand pages open', () => {
        expect(isGatedPath('/preview/cards', LANDING_GATED_PATHS)).toBe(true)
        expect(isGatedPath('/brand/ui', LANDING_GATED_PATHS)).toBe(false)
        expect(isGatedPath('/brand', LANDING_GATED_PATHS)).toBe(false)
    })
})
