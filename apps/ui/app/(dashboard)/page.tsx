import { HomeContent } from '@/components/layout/HomeContent'
import { hasPendingCreatorTerms } from '@/app/api/_auth/expert'
import { resolveCreatorLandingWorkspace } from '@/app/api/_services/sandbox.service'
import { requestHostScope } from '@/lib/brand/host-scope'
import { requestDesktopShell } from '@/lib/desktop-shell/server'
import { workspaceBrand } from '@/lib/brand/workspace'
import { isManagedWorkspace } from '@/lib/workspace/managed'
import { readWorkspaceId } from '@/lib/workspace/host-workspace'
import { createClient, getRequestWorkspaceId } from '@/supabase/server'
import { getSessionIdentity, getSessionWorkspace } from '@/supabase/session/getServerSession'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { SpacePublic } from '@/lib/board/types'
import { WORKSPACE_PARAM } from '@/lib/workspace/workspace-header'
import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { readWelcomeState } from '@/lib/onboarding/welcome.server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

// Fetch côté serveur des spaces : le premier paint affiche déjà le bon contenu (spaces réels OU
// bloc placeholder), sans flash le temps de l'hydratation client.
type HomeSearch = Record<string, string | string[] | undefined>

// Where the welcome page sends them once it is done: back here, with whatever the link carried (a
// template, a share, a prompt, a purchase), which the board then plays as it always has.
function homeWithSearch(search: HomeSearch): string {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(search)) for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item)
    const encoded = query.toString()
    return encoded ? `/?${encoded}` : '/'
}

// Rerun's own address never opens a workspace an organization runs: its people are sent to theirs, with
// whatever the link carried. One named by the link, else the only kind they have.
async function leaveForOrganization(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, workspaceId: number, search: HomeSearch): Promise<void> {
    const [{ data: workspace }, { data: membership }] = await Promise.all([
        selectMaybeSingle(supabase, 'workspaces', ['organization_id'] as const, { id: workspaceId }),
        selectMaybeSingle(supabase, 'workspace_members', ['user_id'] as const, { user_id: userId, workspace_id: workspaceId }),
    ])
    if (!membership || !isManagedWorkspace(workspace)) return
    const { appUrl } = await workspaceBrand(workspaceId)
    // The desktop app lives on Rerun's address.
    if (appUrl && !(await requestDesktopShell())) redirect(`${appUrl}${homeWithSearch(search)}`)
}

const namedWorkspace = (search: HomeSearch): number | null => {
    const value = search[WORKSPACE_PARAM]
    return readWorkspaceId(Array.isArray(value) ? value[0] : value)
}

export default async function Home({ searchParams }: { searchParams: Promise<HomeSearch> }) {
    let initialSpaces: SpacePublic[] = []
    let initialWorkspaceId: number | null = null

    // The token is checked locally. The middleware asks the auth server on every page load; a
    // navigation inside the app relies on the token, valid for under an hour.
    const [supabase, user] = await Promise.all([createClient(), getSessionIdentity()])

    if (user) {
        const { data: storedRow } = await selectMaybeSingle(supabase, 'users', ['workspace_id', 'account_role'] as const, { id: user.id })
        const scope = await requestHostScope()
        const opened = scope ? ((await getSessionWorkspace()).user?.workspace_id ?? null) : (storedRow?.workspace_id ?? null)
        if (scope && !scope.organizationId && opened !== null && (await getRequestWorkspaceId()) === null) {
            const search = await searchParams
            await leaveForOrganization(supabase, user.id, namedWorkspace(search) ?? opened, search)
        }
        // A creator's own places are Rerun's: an organization's address opens none of them.
        const userRow = storedRow && { workspace_id: opened, account_role: scope?.organizationId ? null : storedRow.account_role }

        // Un creator accepté qui n'a pas encore signé les conditions du programme n'entre pas :
        // la vérification passe AVANT resolveCreatorLandingWorkspace, qui lui provisionnerait
        // sinon un sandbox qu'il n'a pas le droit d'ouvrir.
        if (userRow?.account_role === 'expert' && (await hasPendingCreatorTerms(user.id))) redirect('/creator/join')

        if (userRow?.workspace_id) {
            // Un creator qui arrive pour la première fois est basculé sur son sandbox AVANT le rendu.
            // L'onglet suit son propre pin plutôt que `users.workspace_id` : la page atterrit en
            // nommant le sandbox dans l'URL, que la session lit avant le pin.
            const workspaceId = await resolveCreatorLandingWorkspace(user.id, userRow.workspace_id, userRow.account_role === 'expert')
            if (workspaceId !== userRow.workspace_id) redirect(`/?${WORKSPACE_PARAM}=${workspaceId}`)
            initialWorkspaceId = workspaceId

            // The admin of a workspace that never went through the onboarding goes through it first,
            // on the welcome page. Read only while the workspace is not stamped onboarded, which is
            // never again once it is.
            const [{ data: workspaceRow }, { data: spaces }] = await Promise.all([
                selectMaybeSingle(supabase, 'workspaces', ['onboarded_at'] as const, { id: workspaceId }),
                selectMany(supabase, 'spaces', ['id', 'workspace_id', 'name', 'col_start', 'row_start', 'col_end', 'row_end', 'created_at'] as const, { workspace_id: workspaceId }),
            ])
            if (workspaceRow && !workspaceRow.onboarded_at) {
                const ctx = await requireWorkspaceContext().catch(() => null)
                if (ctx?.workspace.id === workspaceId && (await readWelcomeState(ctx)).needed) {
                    const back = homeWithSearch(await searchParams)
                    redirect(back === '/' ? '/welcome' : `/welcome?next=${encodeURIComponent(back)}`)
                }
            }
            initialSpaces = (spaces ?? []) as SpacePublic[]
        }
    }

    return (
        <Suspense fallback={null}>
            <HomeContent initialSpaces={initialSpaces} initialWorkspaceId={initialWorkspaceId} />
        </Suspense>
    )
}
