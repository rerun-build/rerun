import type { OnboardingState } from '@rerun/contracts'

import { requireWorkspaceContext } from '@/app/api/_auth/ownership'
import { loadOnboardingFacts, ONBOARDING_DIALOG_RELEASED_AT } from '@/lib/onboarding/facts'
import { isLegacyWorkspace, onboardingStep } from '@/lib/onboarding/step'
import { readFirstName } from '@/lib/naming/first-name'

// The step of the onboarding dialog, for the browser. Read again after every step it closes: the
// step is the workspace's facts, never a counter the client keeps.
export async function GET(): Promise<Response> {
    let ctx: Awaited<ReturnType<typeof requireWorkspaceContext>>
    try {
        ctx = await requireWorkspaceContext()
    } catch {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const facts = await loadOnboardingFacts(ctx)
    const arrival = facts.foreman.arrival
    const state: OnboardingState = {
        step: onboardingStep(facts, ONBOARDING_DIALOG_RELEASED_AT),
        dialog: !isLegacyWorkspace(facts, ONBOARDING_DIALOG_RELEASED_AT),
        firstName: readFirstName(ctx.authUser.user_metadata) || null,
        arrival: arrival && arrival.kind !== 'prompt' ? { kind: arrival.kind, ref: arrival.ref } : null,
    }
    return Response.json(state)
}
