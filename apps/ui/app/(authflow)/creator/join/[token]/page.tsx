import { redirect } from 'next/navigation'

import { loadCreatorInviteAction } from '@/app/api/_actions/creator-onboarding.actions'
import { getServerSession } from '@/supabase/session/getServerSession'
import { routes } from '@/lib/routes'
import { CreatorJoinRedirect } from '../CreatorJoinRedirect'
import { CreatorOnboarding } from '../CreatorOnboarding'
import { JoinShell } from '../JoinShell'
import { getTranslations } from 'next-intl/server'

export default async function CreatorJoinPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const t = await getTranslations('auth.creatorJoin')

    const result = await loadCreatorInviteAction(token)
    if (result.status === 'not_found') return <JoinShell title={t('notFound.title')} message={t('notFound.message')} />
    if (result.status === 'not_accepted') return <JoinShell title={t('unavailable.title')} message={t('unavailable.message')} />

    const { session } = await getServerSession()

    // An anonymous session carries no email, which is what tells a visitor apart from an account.
    if (!session?.email) {
        return <CreatorJoinRedirect token={token} name={result.invite.name.trim().split(/\s+/)[0]} email={result.invite.email} />
    }

    if (result.invite.takenByAnother) {
        return <JoinShell title={t('taken.title')} message={t('taken.message')} />
    }

    if (result.invite.termsAccepted) redirect(routes.home)

    return <CreatorOnboarding invite={result.invite} token={token} />
}
