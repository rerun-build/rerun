import { z } from 'zod'

// GET /api/v1/onboarding: whether the app walks this workspace through its onboarding, and from where.
// `questions` until the site, the line of work and the role are answered, `setup` once only the trial
// and the machine are left. `waitlisted` when no machine is left to start it on.
export const onboardingStateSchema = z.object({ needed: z.boolean(), stage: z.enum(['questions', 'setup']), waitlisted: z.boolean(), firstName: z.string() })
export type OnboardingState = z.infer<typeof onboardingStateSchema>

// GET /api/v1/onboarding/engine: whether the workspace's machine answers yet.
export const onboardingEngineSchema = z.object({ ready: z.boolean() })
export type OnboardingEngine = z.infer<typeof onboardingEngineSchema>
