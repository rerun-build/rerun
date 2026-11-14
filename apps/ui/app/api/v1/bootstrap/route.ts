import { AuthorizationError, requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { loadMe } from '@/app/api/_services/me.service'
import { provisionUser } from '@/app/api/_services/user-provisioning.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { resolveLocale } from '@rerun/i18n'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'user' }, async ({ ctx }) => {
    await provisionUser(ctx.supabase, ctx.user, { phoneStep: false, priceArm: null, locale: resolveLocale({ acceptLanguage: (await headers()).get('accept-language') }) })
    try {
        return loadMe(await requireWorkspaceContext())
    } catch (err) {
        if (err instanceof AuthorizationError) throw new ApiError(403, err.message)
        throw err
    }
})
