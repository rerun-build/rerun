import { isAdminEmail } from '@/lib/auth/admin-emails'
import { COMPUTER_RELEASED, I18N_RELEASED, PUBLISHED_ACCESS_RELEASED, REWIND_RELEASED } from '@/lib/features'
import { createClient } from '@/supabase/server'
import { dedupe, flag } from 'flags/next'

type Entities = { user?: { email: string } }

export const identify = dedupe(async (): Promise<Entities> => {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    const email = data.user?.email
    return { user: email ? { email: email.toLowerCase() } : undefined }
})

export const releasedOrEarlyAccess =
    (released: boolean, earlyAccessDomains: readonly string[] = []) =>
    ({ entities }: { entities?: Entities }) => {
        const email = entities?.user?.email
        if (released || isAdminEmail(email)) return true
        const domain = email?.split('@')[1]
        return !!domain && earlyAccessDomains.includes(domain)
    }

export const rewindFlag = flag<boolean, Entities>({
    key: 'rewind',
    defaultValue: false,
    identify,
    decide: releasedOrEarlyAccess(REWIND_RELEASED),
})

export const computerFlag = flag<boolean, Entities>({
    key: 'computer',
    defaultValue: false,
    identify,
    decide: releasedOrEarlyAccess(COMPUTER_RELEASED),
})

export const publishedAccessFlag = flag<boolean, Entities>({
    key: 'published-access',
    defaultValue: false,
    identify,
    decide: releasedOrEarlyAccess(PUBLISHED_ACCESS_RELEASED),
})

export const i18nFlag = flag<boolean, Entities>({
    key: 'i18n',
    defaultValue: false,
    identify,
    decide: releasedOrEarlyAccess(I18N_RELEASED, ['rerun.local']),
})
