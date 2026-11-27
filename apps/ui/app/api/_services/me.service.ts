import { displayNameOf, PROFILE_NAME_MAX, readProfile } from '@/lib/auth/user-profile'
import { isSubscriptionEntitled } from '@rerun/cloud/billing'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { brandSignature, type Signer } from '@/app/api/_auth/signature'
import { ORGANIZATION_AUTHOR_ID, type Me, type MessageAuthor } from '@rerun/contracts'
import { getAuthUser } from '@/supabase/session/getServerSession'
import { supportChatTokenOf } from '@/app/api/_services/support-token.service'
import type { User } from '@supabase/supabase-js'

export { displayNameOf, readProfile, type UserProfile } from '@/lib/auth/user-profile'

// Who the engine knows this person as: the organization's staff write under one name.
export function engineMemberIdOf(ctx: Pick<WorkspaceContext, 'userId'> & Signer): string {
    return ctx.organizationStaff ? ORGANIZATION_AUTHOR_ID : ctx.userId
}

// `timezone`: the zone of the device the message was written from (requestTimeZone), so the Chief of
// Staff knows the hour of this member's day.
export async function messageAuthorOf(ctx: Pick<WorkspaceContext, 'userId' | 'authUser'> & Signer, timezone?: string): Promise<MessageAuthor> {
    if (ctx.organizationStaff) {
        // A brand that cannot be read costs the name, never the message, and never shows the person's.
        const brand = await brandSignature(ctx).catch(() => null)
        return { id: engineMemberIdOf(ctx), ...(brand ? { name: brand.name } : {}) }
    }
    const name = displayNameOf(ctx.authUser)?.slice(0, PROFILE_NAME_MAX)
    return { id: engineMemberIdOf(ctx), ...(name ? { name } : {}), ...(timezone ? { timezone } : {}) }
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
    const [authUser, supportChatToken] = await Promise.all([readProfile(ctx.authUser).name ? ctx.authUser : getAuthUser().then(user => user ?? ctx.authUser), supportChatTokenOf(ctx.supabase, ctx.userId)])
    const me = readMe({ ...ctx, authUser }, ctx.userLocale)
    return { ...me, user: { ...me.user, supportChatToken } }
}
