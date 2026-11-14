import { parseConsentCookie, type PriceArm } from '@rerun/contracts'
import { drawVariant, isCrawler, isRetiredVariant, parseExperimentCookie } from '@rerun/analytics/experiments'

export const PRICE_EXPERIMENT_KEY = 'price1'

export const PRICE_PROPERTY = `ab_${PRICE_EXPERIMENT_KEY}`

export function drawPriceArm(request: { experimentCookie: string | undefined; consentCookie: string | undefined; userAgent: string | null }): PriceArm | null {
    const enrolled = parseExperimentCookie(request.experimentCookie)[PRICE_EXPERIMENT_KEY]
    if (enrolled && !isRetiredVariant(PRICE_EXPERIMENT_KEY, enrolled)) return enrolled
    if (parseConsentCookie(request.consentCookie) === 'denied' || isCrawler(request.userAgent)) return null
    return drawVariant(PRICE_EXPERIMENT_KEY)
}
