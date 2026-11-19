import { displayNameOf, PROFILE_NAME_MAX, readProfile } from '@/lib/auth/user-profile'
import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Me, MessageAuthor } from '@rerun/contracts'
import { getAuthUser } from '@/supabase/session/getServerSession'
import type { User } from '@supabase/supabase-js'

export { displayNameOf, readProfile, type UserProfile } from '@/lib/auth/user-profile'

// `timezone`: the zone of the device the message was written from (requestTimeZone), so the Chief of
// Staff knows the hour of this member's day.
export function messageAuthorOf(ctx: Pick<WorkspaceContext, 'userId' | 'authUser'>, timezone?: string): MessageAuthor {
    const name = displayNameOf(ctx.authUser)?.slice(0, PROFILE_NAME_MAX)
    return { id: ctx.userId, ...(name ? { name } : {}), ...(timezone ? { timezone } : {}) }
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
// A token issued before the account had a name does not carry it until its next refresh: the auth
// server is asked for that account, and only for it.
export async function loadMe(ctx: WorkspaceContext): Promise<Me> {
    const authUser = readProfile(ctx.authUser).name ? ctx.authUser : ((await getAuthUser()) ?? ctx.authUser)
    return readMe({ ...ctx, authUser }, ctx.userLocale)
}
