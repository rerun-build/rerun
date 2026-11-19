import { claimWelcomeEngineAction, welcomeEngineAnswersAction } from '@/app/api/_actions/welcome-engine.actions'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi, type OnboardingEngine } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

// Claims the workspace's machine, once: a second call finds it claimed.
export const POST = apiRoute(mobileApi.claimOnboardingEngine, { auth: 'admin' }, async () => {
    const claimed = await claimWelcomeEngineAction()
    if (!claimed.ok) throw new ApiError(503, claimed)
})

// The app asks again until the machine answers.
export const GET = apiRoute(mobileApi.getOnboardingEngine, { auth: 'admin' }, async (): Promise<OnboardingEngine> => ({ ready: await welcomeEngineAnswersAction() }))
