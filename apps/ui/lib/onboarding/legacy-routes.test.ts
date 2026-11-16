import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@rerun/analytics/server', () => ({ captureServer: vi.fn(async () => {}) }))

import { captureServer } from '@rerun/analytics/server'
import { countLegacyOnboardingCall } from './legacy-routes'

describe('countLegacyOnboardingCall', () => {
    beforeEach(() => vi.clearAllMocks())

    it('counts a call with a bearer token as the app, any other as the web', () => {
        countLegacyOnboardingCall(new Request('https://app.rerun.build/api/v1/foreman/intake', { headers: { authorization: 'Bearer abc' } }), 'v1_intake', 'user-1')
        countLegacyOnboardingCall(new Request('https://app.rerun.build/api/chat/foreman'), 'chat_foreman_get', 'user-1')
        expect(captureServer).toHaveBeenNthCalledWith(1, 'user-1', 'legacy_onboarding_route_called', { route: 'v1_intake', client: 'mobile' })
        expect(captureServer).toHaveBeenNthCalledWith(2, 'user-1', 'legacy_onboarding_route_called', { route: 'chat_foreman_get', client: 'web' })
    })
})
