import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { setEnv } from '../config/env.js'
import { readSignedTicket } from './signed-ticket.js'

const sign = (claims: unknown, key: string) => {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}

function readerWith(key: string) {
    setEnv({ RERUN_API_KEY: key })
    return readSignedTicket
}

describe('readSignedTicket', () => {
    it('reads the claims of a ticket signed with the box key and not expired', async () => {
        const read = await readerWith('k')
        expect(read(sign({ exp: 2_000, any: 'thing' }, 'k'), 1_000)).toEqual({ exp: 2_000, any: 'thing' })
    })

    it('refuses claims that are not an object, have no expiry, or are not JSON', async () => {
        const read = await readerWith('k')
        expect(read(sign([1], 'k'), 1_000)).toBeNull()
        expect(read(sign(null, 'k'), 1_000)).toBeNull()
        expect(read(sign({ exp: '2000' }, 'k'), 1_000)).toBeNull()
        const notJson = Buffer.from('{').toString('base64url')
        expect(read(`${notJson}.${createHmac('sha256', 'k').update(notJson).digest('base64url')}`, 1_000)).toBeNull()
    })

    it('reads an unsigned ticket on an engine without a key', async () => {
        const read = await readerWith('')
        expect(read(Buffer.from(JSON.stringify({ exp: 2_000 })).toString('base64url'), 1_000)).toEqual({ exp: 2_000 })
        expect(read('', 1_000)).toBeNull()
    })
})
