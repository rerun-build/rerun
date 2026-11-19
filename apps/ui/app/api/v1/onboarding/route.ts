import { resolveEngineWaitlist } from '@/app/api/_services/waitlist.service'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import type { OnboardingStep } from '@/lib/onboarding/step'
import { readWelcomeState } from '@/lib/onboarding/welcome.server'
import { mobileApi, type OnboardingState } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

const QUESTION_STEPS: readonly OnboardingStep[] = ['site', 'industry', 'role']

// Where the workspace stands in the onboarding of the welcome page, for the app, which walks the same
// one: its questions first, then the trial and the machine. Inviting the team stays on the web.
export const GET = apiRoute(mobileApi.getOnboarding, { auth: 'member' }, async ({ ctx }): Promise<OnboardingState> => {
    const state = await readWelcomeState(ctx)
    return {
        needed: state.needed,
        stage: QUESTION_STEPS.includes(state.step) ? 'questions' : 'setup',
        waitlisted: state.needed && (await resolveEngineWaitlist(ctx.workspace.id)),
        firstName: state.firstName ?? '',
    }
})
