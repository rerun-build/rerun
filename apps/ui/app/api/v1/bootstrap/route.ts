import { AuthorizationError, requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { loadMe } from '@/app/api/_services/me.service'
import { provisionUser } from '@/app/api/_services/user-provisioning.service'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { notOnThisHost } from '@/app/api/v1/auth/_lib/refusal'
import { isRerunHost } from '@/lib/brand/request-site'
import { resolveLocale } from '@rerun/i18n'
import { headers } from 'next/headers'
import { mobileApi } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// Called by the app right after every sign-in. The web provisions a new account in the proxy, which
// never sees a bearer request, so this is the mobile counterpart. Safe to repeat.
export const POST = apiRoute(mobileApi.bootstrap, { auth: 'user' }, async ({ ctx }) => {
    if (!(await isRerunHost())) return notOnThisHost()
    await provisionUser(ctx.supabase, ctx.user, { phoneStep: false, priceArm: null, locale: resolveLocale({ acceptLanguage: (await headers()).get('accept-language') }) })
    try {
        return loadMe(await requireWorkspaceContext())
    } catch (err) {
        // apiRoute turns a refusal past authentication into a 404, but a workspace the device kept and
        // no longer belongs to must answer 403, the status the app falls back to its own workspace on.
        if (err instanceof AuthorizationError) throw new ApiError(403, { error: err.message, code: err.code, params: err.params })
        throw err
    }
})
