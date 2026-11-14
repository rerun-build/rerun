'use client'

import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { isAnalyticsSurface, startAppAnalytics, stopAppAnalytics } from '@/lib/analytics'
import { landingUrl } from '@/lib/site'
import { CookieBanner } from '@rerun/ui/consent'
import { useEffect, useState } from 'react'

export function CookieConsent() {
    const [surface, setSurface] = useState(false)

    useEffect(() => setSurface(isAnalyticsSurface()), [])

    if (!surface || (!RERUN_CLOUD && !process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN)) return null

    return (
        <CookieBanner
            policyHref={landingUrl('/cookies')}
            onGrant={startAppAnalytics}
            onRevoke={stopAppAnalytics}
        />
    )
}
