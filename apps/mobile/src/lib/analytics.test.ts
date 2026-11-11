import { Platform } from 'react-native'

import { forgetPerson, identifyPerson, posthog, track } from '@/lib/analytics'

jest.mock('posthog-react-native', () =>
    jest.fn().mockImplementation((_token: string, options: object) => ({ options, capture: jest.fn(), identify: jest.fn(), register: jest.fn(), reset: jest.fn(), screen: jest.fn(), flush: jest.fn().mockResolvedValue(undefined) }))
)

const client = posthog as unknown as { options: Record<string, unknown>; capture: jest.Mock; identify: jest.Mock; register: jest.Mock; reset: jest.Mock; flush: jest.Mock }

describe('analytics', () => {
    it('sends nothing from a development build, and reports to the EU host of the web project', () => {
        expect(client.options).toMatchObject({ disabled: true, host: 'https://eu.i.posthog.com' })
    })

    it('records sessions with every text, input and image masked, and no console logs', () => {
        expect(client.options).toMatchObject({ enableSessionReplay: true, sessionReplayConfig: { maskAllTextInputs: true, maskAllImages: true, captureLog: false } })
    })

    it('captures the events of the web map with their properties', () => {
        track('phone_verification_completed', { channel: 'sms', context: 'sign_in' })
        expect(client.capture).toHaveBeenCalledWith('phone_verification_completed', { channel: 'sms', context: 'sign_in' })
    })

    it('identifies by email like the web, and flags a non-production person as internal', () => {
        identifyPerson('33600000422@phone.rerun.build')
        expect(client.identify).toHaveBeenCalledWith('33600000422@phone.rerun.build', { $set: { email: '33600000422@phone.rerun.build', is_internal: true } })
    })

    it('sends what is queued before a sign-out wipes the person, and keeps the platform on every event after', async () => {
        client.register.mockClear()
        await forgetPerson()
        expect(client.flush.mock.invocationCallOrder[0]).toBeLessThan(client.reset.mock.invocationCallOrder[0])
        expect(client.register).toHaveBeenCalledWith({ platform: Platform.OS, app_environment: 'local' })
    })
})
