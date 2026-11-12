import { describe, expect, it } from 'vitest'
import { senderAudience } from '../src/main/ipc-guard'

const SERVER = 'https://app.rerun.build'
const LOCAL = 'rerun-shell://app'

describe('senderAudience', () => {
    it('answers the main frame of the server and of the shell’s pages', () => {
        expect(senderAudience({ url: 'https://app.rerun.build/board', isMainFrame: true }, SERVER, LOCAL)).toBe('app')
        expect(senderAudience({ url: 'rerun-shell://app/offline.html?host=x', isMainFrame: true }, SERVER, LOCAL)).toBe('local')
    })

    it('refuses an iframe, even one of the server', () => {
        expect(senderAudience({ url: 'https://app.rerun.build/embed', isMainFrame: false }, SERVER, LOCAL)).toBeNull()
        expect(senderAudience({ url: 'https://js.stripe.com/v3', isMainFrame: false }, SERVER, LOCAL)).toBeNull()
    })

    it('refuses any other origin, a destroyed frame and a page with no server configured', () => {
        expect(senderAudience({ url: 'https://evil.example/', isMainFrame: true }, SERVER, LOCAL)).toBeNull()
        expect(senderAudience({ url: 'https://app.rerun.build.evil.example/', isMainFrame: true }, SERVER, LOCAL)).toBeNull()
        expect(senderAudience(null, SERVER, LOCAL)).toBeNull()
        expect(senderAudience({ url: 'https://app.rerun.build/', isMainFrame: true }, null, LOCAL)).toBeNull()
        expect(senderAudience({ url: 'about:blank', isMainFrame: true }, SERVER, LOCAL)).toBeNull()
    })
})
