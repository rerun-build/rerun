import { finishWelcomeAction } from '@/app/api/_actions/welcome-engine.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'

export const dynamic = 'force-dynamic'

// Closes the onboarding: from here the Chief of Staff on the workspace's machine takes over, and
// owes them its first words.
export const POST = apiRoute({ auth: 'admin' }, async () => {
    const finished = await finishWelcomeAction()
    if (!finished.ok) throw new ApiError(503, finished.error)
})
