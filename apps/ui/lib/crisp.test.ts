import { afterEach, describe, expect, it, vi } from 'vitest'

import { deletedAccountEmailFor } from './auth/placeholder-email'
import { openCrisp, sendToCrisp } from './crisp'

function stubCrisp() {
    const pushed: unknown[][] = []
    vi.stubGlobal('window', { $crisp: { push: (command: unknown[]) => pushed.push(command) } })
    return pushed
}

afterEach(() => vi.unstubAllGlobals())

describe('crisp identity', () => {
    it('tells Crisp the address of an email account', () => {
        const pushed = stubCrisp()
        openCrisp('ada@moldwright.robagentic.tech')
        expect(pushed).toEqual([
            ['set', 'user:email', ['ada@moldwright.robagentic.tech']],
            ['do', 'chat:show'],
            ['do', 'chat:open'],
        ])
    })

    it('tells Crisp the number of a phone account, never its placeholder address', () => {
        const pushed = stubCrisp()
        openCrisp('33612345678@phone.rerun.build')
        expect(pushed).toEqual([
            ['set', 'user:phone', ['+33612345678']],
            ['do', 'chat:show'],
            ['do', 'chat:open'],
        ])
    })

    it('tells Crisp nothing about a deleted or unknown account', () => {
        const pushed = stubCrisp()
        openCrisp(deletedAccountEmailFor('3f4e7b94-0000-4000-8000-000000000001'))
        openCrisp(null)
        expect(pushed.filter(([verb]) => verb === 'set')).toEqual([])
    })

    it('sends the message under the number of a phone account', () => {
        const pushed = stubCrisp()
        sendToCrisp({ email: '33612345678@phone.rerun.build', workspaceId: 7, text: 'Stuck on the card' })
        expect(pushed.slice(0, 3)).toEqual([
            ['set', 'user:phone', ['+33612345678']],
            [
                'set',
                'session:data',
                [
                    [
                        ['workspace_id', '7'],
                        ['source', 'foreman'],
                    ],
                ],
            ],
            ['do', 'message:send', ['text', 'Stuck on the card']],
        ])
        expect(pushed.some(([, key]) => key === 'user:email')).toBe(false)
    })
})
