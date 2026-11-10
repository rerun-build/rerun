import 'server-only'

import { i18nFlag } from '@/flags'
import { TIME_ZONE_COOKIE, validTimeZone } from '@/lib/i18n/time-zone'
import { getSessionWorkspace } from '@/supabase/session/getServerSession'
import { DEFAULT_LOCALE, LOCALE_COOKIE, matchLocale, PSEUDO_LOCALE, resolveLocale, type AppLocale } from '@rerun/i18n'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'

const SUPABASE_SESSION_COOKIE = /^sb-.+-auth-token/

// The cookie mirrors the account's choice on the device that made it, so the account row is only
// read on another device, and never for a visitor without a session. The users row comes from the
// same cached read the dashboard makes anyway.
async function storedAccountLocale(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<string | null> {
    if (!cookieStore.getAll().some(cookie => SUPABASE_SESSION_COOKIE.test(cookie.name))) return null
    const { user } = await getSessionWorkspace()
    return user?.locale ?? null
}

export const requestLocale = cache(async (): Promise<AppLocale> => {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(LOCALE_COOKIE)?.value ?? null
    if (cookie === PSEUDO_LOCALE && process.env.NODE_ENV !== 'production') return PSEUDO_LOCALE

    const userLocale = matchLocale(cookie) ? null : await storedAccountLocale(cookieStore)
    const locale = resolveLocale({ userLocale, cookie, acceptLanguage: (await headers()).get('accept-language') })
    if (locale === DEFAULT_LOCALE) return locale
    return (await i18nFlag()) ? locale : DEFAULT_LOCALE
})

export async function requestTimeZone(): Promise<string | undefined> {
    return validTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value)
}
