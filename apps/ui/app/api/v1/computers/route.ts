import { computersOpenTo, mentionComputerItems } from '@/app/api/_services/remote-computer-items.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'

export const dynamic = 'force-dynamic'

// The computers linked to the workspace, for the iOS app's `#` menu: what the web's dialog lists.
// Empty for a member Computers is not open to yet.
export const GET = apiRoute({ auth: 'member' }, async ({ ctx }) => {
    if (!computersOpenTo(ctx)) return { computers: [], engine: 'none' }
    return mentionComputerItems(ctx)
})
