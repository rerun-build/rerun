import { describe, expect, it } from 'vitest'
import { decidePermission } from '../src/main/permission-policy'

const SERVER = 'https://app.rerun.build'

describe('decidePermission', () => {
    it('grants the server what its features use', () => {
        for (const permission of ['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'display-capture']) {
            expect(decidePermission({ permission, requestingOrigin: SERVER }, SERVER)).toBe(true)
        }
    })

    it('grants the microphone, never the camera', () => {
        expect(decidePermission({ permission: 'media', requestingOrigin: SERVER, mediaTypes: ['audio'] }, SERVER)).toBe(true)
        expect(decidePermission({ permission: 'media', requestingOrigin: SERVER, mediaTypes: ['video'] }, SERVER)).toBe(false)
        expect(decidePermission({ permission: 'media', requestingOrigin: SERVER, mediaTypes: ['audio', 'video'] }, SERVER)).toBe(false)
        expect(decidePermission({ permission: 'media', requestingOrigin: SERVER, mediaTypes: [] }, SERVER)).toBe(false)
        expect(decidePermission({ permission: 'media', requestingOrigin: SERVER, mediaType: 'video' }, SERVER)).toBe(false)
        expect(decidePermission({ permission: 'media', requestingOrigin: SERVER, mediaType: 'audio' }, SERVER)).toBe(true)
    })

    it('refuses what no feature asks for', () => {
        for (const permission of ['geolocation', 'midi', 'pointerLock', 'openExternal', 'hid', 'serial', 'usb']) {
            expect(decidePermission({ permission, requestingOrigin: SERVER }, SERVER)).toBe(false)
        }
    })

    it('refuses every other origin, an embedded page included', () => {
        expect(decidePermission({ permission: 'notifications', requestingOrigin: 'https://js.stripe.com' }, SERVER)).toBe(false)
        expect(decidePermission({ permission: 'clipboard-read', requestingOrigin: '' }, SERVER)).toBe(false)
        expect(decidePermission({ permission: 'notifications', requestingOrigin: SERVER }, null)).toBe(false)
    })
})
