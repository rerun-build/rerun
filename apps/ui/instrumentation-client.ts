import { rememberAttribution } from '@moldwright/analytics/client'
import { analyticsAllowed, detectConsentStatus } from '@moldwright/contracts'
import { isAnalyticsSurface, startAppAnalytics, startAppSessionReplay } from '@/lib/analytics'

rememberAttribution()

if (isAnalyticsSurface()) {
    if (analyticsAllowed(detectConsentStatus())) startAppAnalytics()
    else startAppSessionReplay()
}
