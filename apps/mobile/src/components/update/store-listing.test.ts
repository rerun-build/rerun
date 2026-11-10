import { Linking } from 'react-native'

import { openStoreListing } from './store-listing'

const mockPlatform = { current: 'ios' as 'ios' | 'android' }
jest.mock('@/lib/client-platform', () => ({
    get clientPlatform() {
        return mockPlatform.current
    },
}))

describe('openStoreListing', () => {
    const openURL = jest.spyOn(Linking, 'openURL')

    beforeEach(() => openURL.mockReset().mockResolvedValue(undefined))

    it('opens the App Store on iOS', async () => {
        mockPlatform.current = 'ios'
        await openStoreListing()
        expect(openURL.mock.calls).toEqual([['https://apps.apple.com/app/id6825274993']])
    })

    it('opens the Play Store app on Android', async () => {
        mockPlatform.current = 'android'
        await openStoreListing()
        expect(openURL.mock.calls).toEqual([['market://details?id=build.rerun.app']])
    })

    it('falls back on the Play Store website when no app opens market links', async () => {
        mockPlatform.current = 'android'
        openURL.mockRejectedValueOnce(new Error('No Activity found to handle Intent'))
        await openStoreListing()
        expect(openURL.mock.calls).toEqual([['market://details?id=build.rerun.app'], ['https://play.google.com/store/apps/details?id=build.rerun.app']])
    })
})
