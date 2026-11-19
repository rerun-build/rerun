import { actorFromContext } from '@/app/api/_auth/access'
import { resetServiceConnection } from '@/app/api/_services/services.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { serviceKeyParam } from '@/app/api/v1/_lib/service-view'
import type { ResetConnectionView } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member' }, async ({ ctx, params }): Promise<ResetConnectionView> => {
    const result = await resetServiceConnection(params.id, serviceKeyParam(params), actorFromContext(ctx))
    if (result.mode === 'config') return { mode: 'config', authMethodId: result.authMethodId }
    return { mode: 'auth', pendingAuth: result.app ? 'app' : result.managed ? 'managed' : result.composio ? 'composio' : result.oauth ? 'oauth' : null }
})
