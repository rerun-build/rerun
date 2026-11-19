import { Linking } from 'react-native'

import { openInAppBrowser } from './in-app-browser'
import { loadLinkTarget } from './link-target'
import { hostOf, openExternalUrl } from './url'

jest.mock('./in-app-browser', () => ({ openInAppBrowser: jest.fn() }))
jest.mock('./link-target', () => ({ loadLinkTarget: jest.fn() }))

const openURL = jest.spyOn(Linking, 'openURL')
const linkTarget = jest.mocked(loadLinkTarget)

beforeEach(() => {
    openURL.mockReset().mockResolvedValue(undefined)
    linkTarget.mockReset().mockResolvedValue('browser')
    jest.mocked(openInAppBrowser).mockReset()
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
        expect(openInAppBrowser).not.toHaveBeenCalled()
    })

    it('says nothing opened when no app takes the link', async () => {
        openURL.mockRejectedValueOnce(new Error('No activity found'))
        expect(await openExternalUrl('https://stripe.com/docs')).toBe(false)
    })

    it("keeps the link in Rerun's browser, with its message, when the Preferences ask for it", async () => {
        linkTarget.mockResolvedValue('app')
        expect(await openExternalUrl('https://stripe.com/docs', 'Keys are in stripe.com')).toBe(true)
        expect(openInAppBrowser).toHaveBeenCalledWith({ url: 'https://stripe.com/docs', excerpt: 'Keys are in stripe.com' })
        expect(openURL).not.toHaveBeenCalled()
        expect(await openExternalUrl('javascript:alert(1)')).toBe(false)
        expect(openInAppBrowser).toHaveBeenCalledTimes(1)
    })
})
