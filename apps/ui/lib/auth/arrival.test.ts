import { describe, expect, it } from 'vitest'

import { arrivalOf, RETURN_PATH_MAX } from './arrival'

describe('arrivalOf', () => {
    it('keeps the whole path for the return, and names the template or share link to park', () => {
        expect(arrivalOf('/?template=crm')).toEqual({ returnPath: '/?template=crm', template: 'crm', share: null, prompt: null })
        expect(arrivalOf('/?share=tok')).toEqual({ returnPath: '/?share=tok', template: null, share: 'tok', prompt: null })
    })

    it('leaves the slug of a purchase return alone: it is not an arrival', () => {
        expect(arrivalOf('/?purchase=success&template=crm').template).toBeNull()
    })

    it('keeps a short prompt in the path', () => {
        expect(arrivalOf('/?prompt=Answer+my+leads&name=Scout')).toMatchObject({ returnPath: '/?prompt=Answer+my+leads&name=Scout', prompt: null })
    })

    it('moves a prompt too long for a cookie to the store, and keeps the rest of the path', () => {
        const text = 'answer every lead '.repeat(Math.ceil(RETURN_PATH_MAX / 10)).trim()
        const arrival = arrivalOf(`/?prompt=${encodeURIComponent(text)}&name=Scout&apps=gmail,hubspot&agent=a1`)
        expect(arrival.returnPath).toBe('/?agent=a1')
        expect(arrival.prompt).toEqual({ text, name: 'Scout', apps: ['gmail', 'hubspot'] })
    })
})
