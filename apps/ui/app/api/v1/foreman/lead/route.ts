import { startLeadSetupAction } from '@/app/api/_actions/foreman-lead.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { foremanLeadRequestSchema } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// The button under the build: starts the install of the coworker it put first.
export const POST = apiRoute({ auth: 'member', body: foremanLeadRequestSchema }, async ({ body }) => {
    const started = await startLeadSetupAction(body.agentId)
    if (!started.ok) throw new ApiError(started.inactive ? 409 : 503, started)
    return { conversationId: started.conversationId, runId: started.runId }
})
