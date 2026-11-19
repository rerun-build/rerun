import { isComplete, nextStep, stepsOf, type GettingStartedProgress, type GettingStartedStepId } from '@/lib/onboarding/getting-started'

// What each step is, said to the Chief of Staff, then how it gets it done in a conversation with what
// it holds there.
const STEP_NOTES: Record<GettingStartedStepId, [what: string, how?: string]> = {
    phone: ['verify their phone number', ', from their account'],
    first_agent: ['create their first coworker, for the job they told you they want off their plate'],
    ai_provider: ['plug in their own AI subscription (Claude, ChatGPT or Gemini) or an API key', ', from the AI providers panel (open_settings on ai_providers)'],
    invite: ['invite a teammate', ': ask for the addresses with ask_user, then invite_members with the ones they confirm'],
    schedule: ['give one of their coworkers a recurring task, so it works without being asked'],
    payment_method: ['add a payment method', ', from the billing panel (open_settings on billing); nothing is charged today'],
}

// The checklist the board shows, said to the Chief of Staff while it is not finished: the steps done,
// the one to lead to next, and how to lead without turning every answer into a sales pitch. A
// check-in talks to nobody and holds none of the tools a step is done with: it is told what the
// step is, never how.
export function checklistBlock(progress: GettingStartedProgress | null | undefined, { checkin = false }: { checkin?: boolean } = {}): string | null {
    if (!progress || isComplete(progress)) return null
    const steps = stepsOf(progress)
    const next = nextStep(progress)
    if (!next) return null
    const note = (id: GettingStartedStepId) => (checkin ? STEP_NOTES[id][0] : STEP_NOTES[id].join(''))
    const done = steps.filter(step => progress[step.id]).map(step => note(step.id))
    const lead = checkin
        ? ['It is theirs to do, in a conversation with you: suggest it in your message only when it is the most useful thing to tell them today.']
        : [
              'Lead them there, one step at a time: once what they asked for is handled, offer that next step in one line, never the whole list, and never instead of answering them. When they say not now, drop it for this conversation.',
              'When you tell them you will come back to it later, create in the same turn a routine of your own with schedule_create and checkIn set to true for that day.',
          ]
    return [`This workspace is still getting started: ${done.length} of ${steps.length} steps of its checklist are done.`, done.length ? `Done: ${done.join('; ')}.` : null, `The next step: ${note(next.id)}.`, ...lead].filter(Boolean).join('\n')
}
