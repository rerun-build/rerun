import { HomeContent } from '@/components/layout/HomeContent'
import { hasPendingCreatorTerms } from '@/app/api/_auth/expert'
import { resolveCreatorLandingWorkspace } from '@/app/api/_services/sandbox.service'
import { createClient } from '@/supabase/server'
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

export default async function Home({ searchParams }: { searchParams: Promise<HomeSearch> }) {
    let initialSpaces: SpacePublic[] = []
    let initialWorkspaceId: number | null = null

    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (user) {
        const { data: userRow } = await selectMaybeSingle(supabase, 'users', ['workspace_id', 'account_role'] as const, { id: user.id })

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
            const { data: workspaceRow } = await selectMaybeSingle(supabase, 'workspaces', ['onboarded_at'] as const, { id: workspaceId })
            if (workspaceRow && !workspaceRow.onboarded_at) {
                const ctx = await requireWorkspaceContext().catch(() => null)
                if (ctx?.workspace.id === workspaceId && (await readWelcomeState(ctx)).needed) {
                    const back = homeWithSearch(await searchParams)
                    redirect(back === '/' ? '/welcome' : `/welcome?next=${encodeURIComponent(back)}`)
                }
            }
            const { data: spaces } = await selectMany(supabase, 'spaces', ['id', 'workspace_id', 'name', 'col_start', 'row_start', 'col_end', 'row_end', 'created_at'] as const, { workspace_id: workspaceId })
            initialSpaces = (spaces ?? []) as SpacePublic[]
        }
    }

    return (
        <Suspense fallback={null}>
            <HomeContent initialSpaces={initialSpaces} initialWorkspaceId={initialWorkspaceId} />
        </Suspense>
    )
}
