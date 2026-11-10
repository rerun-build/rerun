import { requestLocale, requestTimeZone } from '@/lib/i18n/request-locale'
import { cloudMessages } from '@rerun/cloud/messages'
import { loadMessages } from '@rerun/i18n/messages'
import { getRequestConfig } from 'next-intl/server'

// The packs of the other surfaces (the landing, the iOS app, the emails and the pushes the server
// writes) never render here: kept out, they stay out of every page the app sends to the browser.
const OTHER_SURFACES = /^(landing|mobile|emails$|push$)/

export default getRequestConfig(async () => {
    const locale = await requestLocale()
    const [all, timeZone] = await Promise.all([cloudMessages(locale).then(extra => loadMessages(locale, [extra])), requestTimeZone()])
    const messages = Object.fromEntries(Object.entries(all).filter(([namespace]) => !OTHER_SURFACES.test(namespace))) as typeof all
    return { locale, messages, timeZone }
})
