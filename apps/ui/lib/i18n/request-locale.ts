import 'server-only'

import { TIME_ZONE_COOKIE } from '@/lib/i18n/time-zone'
import { getSessionWorkspace } from '@/supabase/session/getServerSession'
import { TIME_ZONE_HEADER, validTimeZone } from '@rerun/contracts'
import { LOCALE_COOKIE, PSEUDO_LOCALE, resolveLocale, type AppLocale } from '@rerun/i18n'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'

const SUPABASE_SESSION_COOKIE = /^sb-.+-auth-token/

// Read even when the device has a language cookie: that cookie only holds a choice made on this
// device or on the landing, and the account may have picked another one elsewhere since. The users
// row comes from the same cached read the dashboard makes anyway.
async function storedAccountLocale(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<string | null> {
    if (!cookieStore.getAll().some(cookie => SUPABASE_SESSION_COOKIE.test(cookie.name))) return null
    const { user } = await getSessionWorkspace()
    return user?.locale ?? null
}

export const requestLocale = cache(async (): Promise<AppLocale> => {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(LOCALE_COOKIE)?.value ?? null
    if (cookie === PSEUDO_LOCALE && process.env.NODE_ENV !== 'production') return PSEUDO_LOCALE

    const userLocale = await storedAccountLocale(cookieStore)
    return resolveLocale({ userLocale, cookie, acceptLanguage: (await headers()).get('accept-language') })
})

// The browser's cookie, or the header the mobile app sends with each call.
export async function requestTimeZone(): Promise<string | undefined> {
    return validTimeZone((await headers()).get(TIME_ZONE_HEADER) ?? (await cookies()).get(TIME_ZONE_COOKIE)?.value)
}
