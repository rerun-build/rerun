import { isComplete, nextStep, stepsOf, type GettingStartedProgress, type GettingStartedStepId } from '@/lib/onboarding/getting-started'

// What each step is, said to the Chief of Staff, and how it gets it done with what it holds.
const STEP_NOTES: Record<GettingStartedStepId, string> = {
    phone: 'verify their phone number, from their account',
    first_agent: 'create their first coworker, for the job they told you they want off their plate',
    ai_provider: 'plug in their own AI subscription (Claude, ChatGPT or Gemini) or an API key, from the AI providers panel (open_settings on ai_providers)',
    invite: 'invite a teammate: ask for the addresses with ask_user, then invite_members with the ones they confirm',
    schedule: 'give one of their coworkers a recurring task, so it works without being asked',
    payment_method: 'add a payment method, from the billing panel (open_settings on billing); nothing is charged today',
}

// The checklist the board shows, said to the Chief of Staff while it is not finished: the steps done,
// the one to lead to next, and how to lead without turning every answer into a sales pitch.
export function checklistBlock(progress: GettingStartedProgress | null | undefined): string | null {
    if (!progress || isComplete(progress)) return null
    const steps = stepsOf(progress)
    const next = nextStep(progress)
    if (!next) return null
    const done = steps.filter(step => progress[step.id]).map(step => STEP_NOTES[step.id])
    return [
        `This workspace is still getting started: ${done.length} of ${steps.length} steps of its checklist are done.`,
        done.length ? `Done: ${done.join('; ')}.` : null,
        `The next step: ${STEP_NOTES[next.id]}.`,
        'Lead them there, one step at a time: once what they asked for is handled, offer that next step in one line, never the whole list, and never instead of answering them. When they say not now, drop it for this conversation.',
        'When you tell them you will come back to it later, create in the same turn a routine of your own with schedule_create and checkIn set to true for that day.',
    ]
        .filter(Boolean)
        .join('\n')
}
