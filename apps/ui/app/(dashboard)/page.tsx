import { HomeContent } from '@/components/layout/HomeContent'
import { hasPendingCreatorTerms } from '@/app/api/_auth/expert'
import { resolveCreatorLandingWorkspace } from '@/app/api/_services/sandbox.service'
import { createClient } from '@/supabase/server'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { SpacePublic } from '@/lib/board/types'
import { WORKSPACE_PARAM } from '@/lib/workspace/workspace-header'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

// Fetch côté serveur des spaces : le premier paint affiche déjà le bon contenu (spaces réels OU
// bloc placeholder), sans flash le temps de l'hydratation client.
export default async function Home() {
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
