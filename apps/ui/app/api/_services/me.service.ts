import { displayNameOf, PROFILE_NAME_MAX, readProfile } from '@/lib/auth/user-profile'
import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Me, MessageAuthor } from '@rerun/contracts'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import type { User } from '@supabase/supabase-js'

export { displayNameOf, readProfile, type UserProfile } from '@/lib/auth/user-profile'

export function messageAuthorOf(ctx: Pick<WorkspaceContext, 'userId' | 'authUser'>): MessageAuthor {
    const name = displayNameOf(ctx.authUser)?.slice(0, PROFILE_NAME_MAX)
    return name ? { id: ctx.userId, name } : { id: ctx.userId }
}

export function readMe(ctx: WorkspaceContext, locale: string | null = null): Me {
    return {
        user: {
            id: ctx.userId,
            email: ctx.userEmail,
            ...readProfile(ctx.authUser),
            locale,
        },
        workspace: {
            id: ctx.workspace.id,
            name: ctx.workspace.name,
            iconUrl: ctx.workspace.icon_url,
            plan: ctx.workspace.plan,
            subscribed: ctx.workspace.is_sandbox || isSubscriptionEntitled(ctx.workspace.subscription_status),
            role: ctx.role,
            boxScope: ctx.boxScope,
        },
    }
}

// What the app shows its user, with the language their account picked so the iOS app follows it.
export async function loadMe(ctx: WorkspaceContext): Promise<Me> {
    const { data } = await selectMaybeSingle(ctx.supabase, 'users', ['locale'] as const, { id: ctx.userId })
    return readMe(ctx, data?.locale ?? null)
}
