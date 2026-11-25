import { getTranslations } from 'next-intl/server'
import { notFound, redirect } from 'next/navigation'

import { InviteCard } from '@/app/(authflow)/invite/[token]/InviteCard'
import { InviteMismatch } from '@/app/(authflow)/invite/[token]/InviteMismatch'
import { InviteRedirect } from '@/app/(authflow)/invite/[token]/InviteRedirect'
import { acceptOrganizationInvitationAction, loadOrganizationInvitationAction } from '@/ee/actions/organization.actions'
import { CONSOLE_HOME } from '@/ee/lib/organizations/console-routes'
import { teamInvitationPath } from '@/ee/services/organization-team.service'
import { ownsEmail } from '@/lib/auth/account-emails'
import { accountLabel } from '@/lib/auth/placeholder-email'
import { getAuthUser } from '@/supabase/session/getServerSession'
import { ORGANIZATIONS_ENABLED } from '@rerun/cloud/organizations'

export default async function TeamInvitePage({ params }: { params: Promise<{ token: string }> }) {
    if (!ORGANIZATIONS_ENABLED) notFound()
    const { token } = await params
    const t = await getTranslations('organization.join')
    const tInvite = await getTranslations('auth.invite')
    const tErrors = await getTranslations('errors')

    const invite = await loadOrganizationInvitationAction(token)
    if (invite.status === 'not_found') return <InviteCard title={tInvite('notFound.title')} message={tInvite('notFound.message')} />
    if (invite.status === 'expired') return <InviteCard title={tInvite('expired.title')} message={t('expired')} />

    const account = await getAuthUser()

    if (invite.status === 'unavailable') {
        // Its own link, opened again by whoever it let in.
        if (account?.email && (await acceptOrganizationInvitationAction(token)).ok) redirect(CONSOLE_HOME)
        return <InviteCard title={tInvite('unavailable.title')} message={tInvite('unavailable.message')} />
    }

    const { email, organizationName } = invite
    if (!account?.email) return <InviteRedirect next={teamInvitationPath(token)} email={email} title={t('title', { organization: organizationName })} message={t('signIn', { email })} />
    if (!ownsEmail(account, email)) return <InviteMismatch inviteEmail={email} currentEmail={accountLabel(account.email) ?? account.email} workspaceName={organizationName} />

    const result = await acceptOrganizationInvitationAction(token)
    if (!result.ok) return <InviteCard title={t('failed')} message={result.code ? tErrors(result.code, result.params as never) : result.error} />
    redirect(CONSOLE_HOME)
}
