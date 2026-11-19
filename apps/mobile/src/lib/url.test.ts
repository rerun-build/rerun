import { Linking } from 'react-native'

import { hostOf, openExternalUrl } from './url'

const openURL = jest.spyOn(Linking, 'openURL')

beforeEach(() => {
    openURL.mockReset().mockResolvedValue(undefined)
})

describe('hostOf', () => {
    it('reads the host a person would be sent to, userinfo, port and www set aside', () => {
        expect(hostOf('https://www.stripe.com/docs/keys')).toBe('stripe.com')
        expect(hostOf('https://stripe.com@evil.example/keys')).toBe('evil.example')
        expect(hostOf('https://Evil.Example:8443/x?u=https://stripe.com')).toBe('evil.example')
        expect(hostOf('not a url')).toBeNull()
        expect(hostOf(undefined)).toBeNull()
    })
})

describe('openExternalUrl', () => {
    it("opens a web page in the phone's browser and nothing else", async () => {
        expect(await openExternalUrl('https://stripe.com/docs')).toBe(true)
        expect(openURL).toHaveBeenCalledWith('https://stripe.com/docs')
        expect(await openExternalUrl('javascript:alert(1)')).toBe(false)
        expect(await openExternalUrl('file:///etc/passwd')).toBe(false)
        expect(openURL).toHaveBeenCalledTimes(1)
    })

    it('says nothing opened when no app takes the link', async () => {
        openURL.mockRejectedValueOnce(new Error('No activity found'))
        expect(await openExternalUrl('https://stripe.com/docs')).toBe(false)
    })
})
