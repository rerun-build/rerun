import { ownsEmail } from '@/lib/auth/account-emails'
import { accountLabel } from '@/lib/auth/placeholder-email'
import { acceptInvitationAction, joinedWorkspaceForInvitationAction, loadInvitationAction } from '@/app/api/_actions/members.actions'
import { routes } from '@/lib/routes'
import { WORKSPACE_PARAM } from '@/lib/workspace/workspace-header'
import { getAuthUser } from '@/supabase/session/getServerSession'
import { redirect } from 'next/navigation'
import { InviteCard } from './InviteCard'
import { InviteMismatch } from './InviteMismatch'
import { InviteRedirect } from './InviteRedirect'
import { getTranslations } from 'next-intl/server'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const t = await getTranslations('auth.invite')
    const tErrors = await getTranslations('errors')

    const invite = await loadInvitationAction(token)
    if (invite.status === 'not_found') return <InviteCard title={t('notFound.title')} message={t('notFound.message')} />
    if (invite.status === 'elsewhere') redirect(invite.url)
    if (invite.status === 'unavailable') {
        const joinedWorkspaceId = await joinedWorkspaceForInvitationAction(token)
        if (joinedWorkspaceId !== null) redirect(`${routes.home}?${WORKSPACE_PARAM}=${joinedWorkspaceId}`)
        return <InviteCard title={t('unavailable.title')} message={t('unavailable.message')} />
    }
    if (invite.status === 'expired') return <InviteCard title={t('expired.title')} message={t('expired.message')} />

    const account = await getAuthUser()

    if (!account?.email) return <InviteRedirect next={`/invite/${token}`} email={invite.email} title={t('redirect.title', { workspace: invite.workspaceName })} message={t('redirect.message', { email: invite.email })} />
    if (!ownsEmail(account, invite.email)) return <InviteMismatch inviteEmail={invite.email} currentEmail={accountLabel(account.email) ?? account.email} workspaceName={invite.workspaceName} />

    const result = await acceptInvitationAction(token)
    if (!result.ok) return <InviteCard title={t('joinFailed')} message={result.code ? tErrors(result.code, result.params as never) : result.error} />

    // Named in the URL so a tab already pinned on another workspace lands on the joined one.
    redirect(`${routes.home}?${WORKSPACE_PARAM}=${result.workspaceId}`)
}
