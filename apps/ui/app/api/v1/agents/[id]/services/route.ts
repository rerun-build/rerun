import { actorFromContext } from '@/app/api/_auth/access'
import { listInstalledServices } from '@/app/api/_services/services.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import type { InstalledServiceView } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute({ auth: 'member' }, async ({ ctx, params }): Promise<InstalledServiceView[]> => {
    const { services } = await listInstalledServices(params.id, actorFromContext(ctx))
    return services.map(s => ({ key: s.key, slug: s.slug, instanceId: s.instanceId, label: s.label, name: s.name, icon: s.icon, category: s.category, status: s.status, toolNames: s.toolNames, authMethodId: s.authMethodId, installedAt: s.installedAt }))
})
