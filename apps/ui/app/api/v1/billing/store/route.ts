import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { appPlatformOf } from '@/app/api/v1/_lib/client-platform'
import { getStoreOffer } from '@/ee/services/store-billing.service'
import { storeProviderOf, type StoreOffer } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// What the app may sell this workspace through the store it was installed from. Open to every
// member, so the app can tell a member to ask an admin rather than meeting a 403.
export const GET = apiRoute({ auth: 'member' }, async ({ req, ctx }): Promise<StoreOffer> => getStoreOffer(ctx, storeProviderOf(appPlatformOf(req))))
