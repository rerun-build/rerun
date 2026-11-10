import { openDesktopAction } from '@/app/api/_actions/desktop.actions'
import { ApiError, apiRoute, deniedStatus } from '@/app/api/v1/_lib/api-route'
import { desktopSocketRequestSchema, type DesktopSocketView } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The socket to one coworker's screen, to watch it or drive it, with the same checks as the web: a
// member of the workspace, a coworker on the machine, a machine that has a screen.
export const POST = apiRoute({ auth: 'member', body: desktopSocketRequestSchema }, async ({ params, body }): Promise<DesktopSocketView> => {
    const opened = await openDesktopAction(params.id, body.mode, body.timeZone)
    if (!opened.ok) throw new ApiError(deniedStatus(opened.denied, 503), opened.error)
    return { socketUrl: opened.socketUrl, dock: opened.dock }
})
