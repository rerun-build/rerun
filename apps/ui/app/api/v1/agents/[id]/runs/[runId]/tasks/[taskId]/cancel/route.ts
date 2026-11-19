import { cancelSubRunAction } from '@/app/api/_actions/agent.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import { assertPathId } from '@/app/api/v1/_lib/path-ids'

export const dynamic = 'force-dynamic'

// One task of a delegation stopped, the rest of the run carries on.
export const POST = apiRoute({ auth: 'member' }, async ({ params }) => {
    const runId = assertPathId(params.runId, 'runNotFound')
    const taskId = assertPathId(params.taskId, 'taskNotFound')
    if (!(await cancelSubRunAction(params.id, runId, taskId))) throw new ApiError(503, refusal('stopTaskFailed'))
})
