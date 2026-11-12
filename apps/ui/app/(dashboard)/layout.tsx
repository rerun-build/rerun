import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { CrispChat } from '@rerun/cloud/support'
import { BoardChatSplit } from '@/components/layout/BoardChatSplit'
import { FeatureFlagsProvider } from '@/components/layout/FeatureFlagsProvider'
import { WorkspaceSwitchLoader } from '@/components/layout/WorkspaceSwitchLoader'
import { paidAppFlags } from '@rerun/cloud/apps.server'
import { startBackgroundSchedules } from '@rerun/cloud/tasks'
import { computerFlag, i18nFlag, publishedAccessFlag, rewindFlag } from '@/flags'
import { FOREMAN_PLACEMENT_COOKIE, parseForemanPlacement } from '@/lib/foreman-layout'
import { FOREMAN_OPEN_COOKIE, parseForemanOpen } from '@/lib/foreman-open'
import { createClient } from '@/supabase/server'
import { SessionProvider } from '@/supabase/session/SessionProvider'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('layout.dashboard')
    return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    // Once per server process, on the first board anyone opens: the crons a self-hosted app runs itself.
    startBackgroundSchedules()
    const [rewind, computer, published, i18n, apps] = await Promise.all([rewindFlag(), computerFlag(), publishedAccessFlag(), i18nFlag(), paidAppFlags()])
    // Les miroirs des préférences de la colonne, ouverture et placement, pour la rendre déjà à sa place.
    const cookieStore = await cookies()
    const foremanOpen = parseForemanOpen(cookieStore.get(FOREMAN_OPEN_COOKIE)?.value)
    const foremanPlacement = parseForemanPlacement(cookieStore.get(FOREMAN_PLACEMENT_COOKIE)?.value)
    // The session loads in the browser: without this the workspace rail would push the board aside
    // once it arrives.
    const { data: auth } = await (await createClient()).auth.getClaims()
    const signedIn = Boolean(auth?.claims.sub) && auth?.claims.is_anonymous !== true

    return (
        <SessionProvider>
            <FeatureFlagsProvider rewind={rewind} computer={computer} published={published} i18n={i18n} apps={apps}>
                <BoardChatSplit initialOpen={foremanOpen} initialPlacement={foremanPlacement} initialSignedIn={signedIn}>{children}</BoardChatSplit>
                <CrispChat hideLauncher position="left" />
                <WorkspaceSwitchLoader />
            </FeatureFlagsProvider>
        </SessionProvider>
    )
}
