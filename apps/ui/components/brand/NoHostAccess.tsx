import { SwitchAccountButton } from '@/components/published/SwitchAccountButton'
import { realEmail } from '@/lib/auth/placeholder-email'
import { routes } from '@/lib/routes'
import { getAuthUser } from '@/supabase/session/getServerSession'
import { isInOrganizationTeam, joinOrganization } from '@rerun/cloud/organizations.server'
import { DEFAULT_LOCALE, isStableLocale } from '@rerun/i18n'
import { getLocale, getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { HostNotice } from './HostNotice'

// Signed in on an organization's address with none of its workspaces to open: its team has the console,
// someone invited since they signed in joins now, and anybody else is told so.
export async function NoHostAccess({ organizationId, userId }: { organizationId: string; userId: string }) {
    if (await isInOrganizationTeam(organizationId, userId)) redirect('/organization')

    const [account, spoken, t] = await Promise.all([getAuthUser(), getLocale(), getTranslations('managed.host.noAccess')])
    const locale = isStableLocale(spoken) ? spoken : DEFAULT_LOCALE
    if (account && (await joinOrganization(account, organizationId, { locale }))) redirect(routes.home)

    const email = realEmail(account?.email)
    return (
        <HostNotice title={t('title')} message={email ? t('body', { email }) : t('bodyUnnamed')}>
            <SwitchAccountButton returnTo={routes.home} />
        </HostNotice>
    )
}
