import type { PhaseSpec } from '@/lib/foreman/phases/spec'

export const TRIAL_PHASE: PhaseSpec = {
    phase: 'trial',
    instructions: () => 'Their workspace is ready. Say in one line that their coworkers are being set up.',
    tools: ['search_docs', 'contact_team'],
}
