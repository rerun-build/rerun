import { cancelSubRunAction } from '@/app/api/_actions/agent.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { assertPathId } from '@/app/api/v1/_lib/path-ids'

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'member' }, async ({ params }) => {
    const runId = assertPathId(params.runId, 'Run not found')
    const taskId = assertPathId(params.taskId, 'Task not found')
    if (!(await cancelSubRunAction(params.id, runId, taskId))) throw new ApiError(503, 'Could not stop this task')
})
