import 'server-only'

import type { AnalyticsEventMap } from '@rerun/analytics'
import { captureServer } from '@rerun/analytics/server'

type LegacyRoute = AnalyticsEventMap['legacy_onboarding_route_called']['route']

// Not awaited: the routes it measures answer no slower, and a count that fails changes nothing.
export function countLegacyOnboardingCall(req: Request, route: LegacyRoute, userId: string): void {
    const client = req.headers.get('authorization')?.startsWith('Bearer ') ? 'mobile' : 'web'
    captureServer(userId, 'legacy_onboarding_route_called', { route, client }).catch(() => {})
}
