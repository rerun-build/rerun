import { isAdminEmail } from '@/lib/auth/admin-emails'
import { COMPUTER_RELEASED, I18N_RELEASED, PUBLISHED_ACCESS_RELEASED, SIMPLE_VIEW_RELEASED, VAULT_RELEASED } from '@/lib/features'
import { createClient } from '@/supabase/server'
import { dedupe, flag } from 'flags/next'

type Entities = { user?: { email: string } }

export const identify = dedupe(async (): Promise<Entities> => {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    const email = data.user?.email
    return { user: email ? { email: email.toLowerCase() } : undefined }
})

// Une feature pas encore lancée n'existe que pour les admins et les domaines email en accès anticipé.
// Le jour du lancement, la constante de lib/features passe à `true` et le flag s'ouvre à tout le monde
// sans toucher aux points d'appel.
export const releasedOrEarlyAccess =
    (released: boolean, earlyAccessDomains: readonly string[] = []) =>
    ({ entities }: { entities?: Entities }) => {
        const email = entities?.user?.email
        if (released || isAdminEmail(email)) return true
        const domain = email?.split('@')[1]
        return !!domain && earlyAccessDomains.includes(domain)
    }

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

// `rerun.local` is the domain of the throwaway accounts `pnpm verify:ui` signs in with on the local
// stack, so a pack can be looked at before it ships. No inbox answers there.
export const i18nFlag = flag<boolean, Entities>({
    key: 'i18n',
    defaultValue: false,
    identify,
    decide: releasedOrEarlyAccess(I18N_RELEASED, ['rerun.local']),
})

// The verify accounts of the local stack see it too, so the Vault can be walked through before it ships.
export const vaultFlag = flag<boolean, Entities>({
    key: 'vault',
    defaultValue: false,
    identify,
    decide: releasedOrEarlyAccess(VAULT_RELEASED, ['rerun.local']),
})

export const simpleViewFlag = flag<boolean, Entities>({
    key: 'simple-view',
    defaultValue: false,
    identify,
    decide: releasedOrEarlyAccess(SIMPLE_VIEW_RELEASED, ['rerun.local']),
})
