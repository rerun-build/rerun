'use client'

import { TIME_ZONE_COOKIE } from '@/lib/i18n/time-zone'
import { useEffect } from 'react'

const ONE_YEAR = 60 * 60 * 24 * 365

export function TimeZoneCookie() {
    useEffect(() => {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
        if (!timeZone || document.cookie.includes(`${TIME_ZONE_COOKIE}=${encodeURIComponent(timeZone)}`)) return
        document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(timeZone)}; path=/; max-age=${ONE_YEAR}; samesite=lax`
    }, [])
    return null
}
