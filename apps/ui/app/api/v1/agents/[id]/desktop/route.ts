import { openDesktopAction } from '@/app/api/_actions/desktop.actions'
import { ApiError, apiRoute, deniedStatus } from '@/app/api/v1/_lib/api-route'
import { desktopSocketRequestSchema, type DesktopSocketView } from '@moldwright/contracts'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member', body: desktopSocketRequestSchema }, async ({ params, body }): Promise<DesktopSocketView> => {
    const opened = await openDesktopAction(params.id, body.mode, body.timeZone)
    if (!opened.ok) throw new ApiError(deniedStatus(opened.denied, 503), opened.error)
    return { socketUrl: opened.socketUrl, dock: opened.dock }
})
