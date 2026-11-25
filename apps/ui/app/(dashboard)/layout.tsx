import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { CrispChat } from '@rerun/cloud/support'
import { CoworkerLooks } from '@/components/agent/CoworkerLooks'
import { BoardChatSplit } from '@/components/layout/BoardChatSplit'
import { FeatureFlagsProvider } from '@/components/layout/FeatureFlagsProvider'
import { WorkspaceSwitchLoader } from '@/components/layout/WorkspaceSwitchLoader'
import { QuickAskReceiver } from '@/components/desktop-shell/QuickAskReceiver'
import { paidAppFlags } from '@rerun/cloud/apps.server'
import { startBackgroundSchedules } from '@rerun/cloud/tasks'
import { WorkspaceViewProvider } from '@/components/workspace-view/WorkspaceViewProvider'
import { FOREMAN_PLACEMENT_COOKIE, parseForemanPlacement } from '@/lib/foreman-layout'
import { FOREMAN_OPEN_COOKIE, parseForemanOpen } from '@/lib/foreman-open'
import { parseWorkspaceView, WORKSPACE_VIEW_COOKIE } from '@/lib/workspace-view'
import { isTeamSession, TEAM_SESSION_COOKIE } from '@/lib/auth/team-session'
import { getServerSession } from '@/supabase/session/getServerSession'
import { supportChatTokenOf } from '@/app/api/_services/support-token.service'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { SessionProvider, type InitialSession } from '@/supabase/session/SessionProvider'
import { getBrand } from '@/lib/brand/server'
import { requestHostScope } from '@/lib/brand/host-scope'
import { NoHostAccess } from '@/components/brand/NoHostAccess'
import { workspaceBrand } from '@/lib/brand/workspace'
import { RerunOnly } from '@/components/brand/RerunOnly'
import { WorkspaceBrandProvider } from '@/components/brand/WorkspaceBrandProvider'
import { isManagedWorkspace } from '@/lib/workspace/managed'
import { isWhiteLabel } from '@rerun/contracts'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('layout.dashboard')
    return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    // Once per server process, on the first board anyone opens: the crons a self-hosted app runs itself.
    startBackgroundSchedules()
    const [apps, session, hostBrand, hostScope] = await Promise.all([paidAppFlags(), getServerSession(), getBrand(), requestHostScope()])
    if (hostScope?.organizationId && session.session && !session.user) return <NoHostAccess organizationId={hostScope.organizationId} userId={session.session.id} />
    const cookieStore = await cookies()
    // The team on a customer's account must not open that customer's conversation. On Rerun's address the
    // key is there whatever the workspace: going from a managed one to another reloads nothing.
    const opensAccountChat = !isWhiteLabel(hostBrand) && !isTeamSession(cookieStore.get(TEAM_SESSION_COOKIE)?.value, session.user?.id)
    const [brand, supportChatToken] = await Promise.all([
        !isWhiteLabel(hostBrand) && session.workspace && isManagedWorkspace(session.workspace) ? workspaceBrand(session.workspace.id) : hostBrand,
        session.user && opensAccountChat ? supportChatTokenOf(createServiceRoleClient(), session.user.id) : null,
    ])
    // The session this request already verified, so the browser does not read it again before the board.
    const initialSession: InitialSession | null = session.user && session.workspace && session.membership ? { user: session.user, workspace: session.workspace, role: session.membership.role, boxScope: session.membership.box_scope, organizationStaff: session.membership.organization_staff } : null
    // Les miroirs des préférences de la colonne, ouverture et placement, pour la rendre déjà à sa place.
    const foremanOpen = parseForemanOpen(cookieStore.get(FOREMAN_OPEN_COOKIE)?.value)
    const foremanPlacement = parseForemanPlacement(cookieStore.get(FOREMAN_PLACEMENT_COOKIE)?.value)
    const workspaceView = parseWorkspaceView(cookieStore.get(WORKSPACE_VIEW_COOKIE)?.value)

    return (
        <SessionProvider initial={initialSession} hostScope={hostScope}>
            <WorkspaceBrandProvider initial={brand}>
                <FeatureFlagsProvider apps={apps}>
                    <WorkspaceViewProvider initialView={workspaceView}>
                        <CoworkerLooks>
                            <BoardChatSplit initialOpen={foremanOpen} initialPlacement={foremanPlacement}>{children}</BoardChatSplit>
                        </CoworkerLooks>
                        <RerunOnly>
                            <CrispChat tokenId={supportChatToken} hideLauncher position="left" />
                        </RerunOnly>
                        <WorkspaceSwitchLoader />
                        <QuickAskReceiver />
                    </WorkspaceViewProvider>
                </FeatureFlagsProvider>
            </WorkspaceBrandProvider>
        </SessionProvider>
    )
}
