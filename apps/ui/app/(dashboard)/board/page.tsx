import { HomeContent } from '@/components/layout/HomeContent'
import { AppLoader } from '@/components/layout/AppLoader'
import { hasPendingCreatorTerms } from '@/app/api/_auth/expert'
import { resolveCreatorLandingWorkspace } from '@/app/api/_services/sandbox.service'
import { createClient } from '@/supabase/server'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { SpacePublic } from '@/lib/board/types'
import { routes } from '@/lib/routes'
import { WORKSPACE_PARAM } from '@/lib/workspace/workspace-header'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

export default async function Home() {
    let initialSpaces: SpacePublic[] = []
    let initialWorkspaceId: number | null = null

    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (user) {
        const { data: userRow } = await selectMaybeSingle(supabase, 'users', ['workspace_id', 'account_role'] as const, { id: user.id })

        if (userRow?.account_role === 'expert' && (await hasPendingCreatorTerms(user.id))) redirect('/creator/join')

        if (userRow?.workspace_id) {
            const workspaceId = await resolveCreatorLandingWorkspace(user.id, userRow.workspace_id, userRow.account_role === 'expert')
            if (workspaceId !== userRow.workspace_id) redirect(`${routes.board}?${WORKSPACE_PARAM}=${workspaceId}`)
            initialWorkspaceId = workspaceId
            const { data: spaces } = await selectMany(supabase, 'spaces', ['id', 'workspace_id', 'name', 'col_start', 'row_start', 'col_end', 'row_end', 'created_at'] as const, { workspace_id: workspaceId })
            initialSpaces = (spaces ?? []) as SpacePublic[]
        }
    }

    return (
        <Suspense
            fallback={<AppLoader />}
        >
            <HomeContent initialSpaces={initialSpaces} initialWorkspaceId={initialWorkspaceId} />
        </Suspense>
    )
}
