import { foremanClientSchema } from '@rerun/contracts'
import { Platform } from 'react-native'

import { onboardingSendBody } from './useOnboardingChat'

describe('onboardingSendBody', () => {
    it('tells the hub which app walks the onboarding, so it keeps prices out of it', () => {
        const body = onboardingSendBody('session-1', [])
        expect(body).toEqual({ sessionId: 'session-1', messages: [], client: Platform.OS })
        expect(foremanClientSchema.parse(body.client)).toBe(Platform.OS)
    })
})
