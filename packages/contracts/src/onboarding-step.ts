import { z } from 'zod'

// The step of the onboarding a workspace stands on, derived from what it already has on every read
// (apps/ui/lib/onboarding/step.ts) and drawn the same way on the web and in the app. `profile` is the
// welcome questions, walked on the client and sent at once. `done` closes the dialog for good.
export const ONBOARDING_STEPS = ['profile', 'phone', 'invite', 'waitlist', 'trial', 'claiming', 'installing', 'handoff', 'restoring', 'done'] as const

export const onboardingStepSchema = z.enum(ONBOARDING_STEPS)

export type OnboardingStep = z.infer<typeof onboardingStepSchema>

export const onboardingStateSchema = z.object({
    step: onboardingStepSchema,
    // The workspace walks this dialog rather than the hub's onboarding, which it keeps when it is
    // older than the release. Always `done` when false.
    dialog: z.boolean(),
    // Known from the sign-up (Google carries it), so the questions skip asking it.
    firstName: z.string().nullable(),
    // Set when they came in on a template or a shared coworker: no questions, no invitation step.
    arrival: z.object({ kind: z.enum(['template', 'share']), ref: z.string() }).nullable(),
})

export type OnboardingState = z.infer<typeof onboardingStateSchema>
