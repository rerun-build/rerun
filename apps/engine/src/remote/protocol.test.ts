import { describe, expect, it } from 'vitest'
import { REMOTE_MAX_TEXT_FRAME_BYTES, negotiateRemoteProtocol, parseRemoteFrame, remoteHandleFromName, remoteHelloSchema, REMOTE_HANDLE_PATTERN } from '@rerun/contracts'

describe('the remote computer protocol', () => {
    it('agrees on the highest version both ends speak, and on none when their ranges do not meet', () => {
        expect(negotiateRemoteProtocol({ min: 1, max: 1 }, { min: 1, max: 1 })).toBe(1)
        expect(negotiateRemoteProtocol({ min: 1, max: 4 }, { min: 2, max: 3 })).toBe(3)
        expect(negotiateRemoteProtocol({ min: 1, max: 2 }, { min: 3, max: 5 })).toBeNull()
        expect(negotiateRemoteProtocol({ min: 6, max: 9 }, { min: 3, max: 5 })).toBeNull()
        expect(negotiateRemoteProtocol({ min: 1, max: 9 })).toBe(1)
    })

    it('reads a frame only when it is JSON, of the shape asked, and not too big', () => {
        const hello = { type: 'hello', protocol: { min: 1, max: 1 }, app: { version: '1' }, capabilities: ['shell'], facts: { hostname: 'h', os: 'win', osVersion: '11', arch: 'x64', shell: 'powershell', homeDir: 'C:\\Users\\a', workDir: 'C:\\Users\\a\\Rerun' } }
        expect(parseRemoteFrame(remoteHelloSchema, JSON.stringify(hello))).toMatchObject({ paused: false, facts: { os: 'win' } })
        expect(parseRemoteFrame(remoteHelloSchema, '{')).toBeNull()
        expect(parseRemoteFrame(remoteHelloSchema, JSON.stringify({ ...hello, capabilities: ['teleport'] }))).toBeNull()
        expect(parseRemoteFrame(remoteHelloSchema, JSON.stringify({ ...hello, pad: 'x'.repeat(REMOTE_MAX_TEXT_FRAME_BYTES) }))).toBeNull()
        expect(parseRemoteFrame(remoteHelloSchema, JSON.stringify({ ...hello, pad: 'é'.repeat(REMOTE_MAX_TEXT_FRAME_BYTES / 2) }))).toBeNull()
    })

    it('turns a name into a handle that can be typed after #', () => {
        expect(remoteHandleFromName('Studio PC')).toBe('studio-pc')
        expect(remoteHandleFromName("Claire's MacBook Pro")).toBe('claire-s-macbook-pro')
        expect(remoteHandleFromName('Montage été')).toBe('montage-ete')
        expect(remoteHandleFromName('---')).toBe('')
        expect(remoteHandleFromName('电脑')).toBe('')
        const long = remoteHandleFromName('a very long computer name that goes on and on and on')
        expect(long.length).toBeLessThanOrEqual(32)
        expect(long).toMatch(REMOTE_HANDLE_PATTERN)
        expect(remoteHandleFromName('abcdefghijklmnopqrstuvwxyz abcdef-ghi')).toMatch(REMOTE_HANDLE_PATTERN)
    })
})
