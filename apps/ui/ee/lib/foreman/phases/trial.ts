import { checkoutTerms } from './checkout-terms'
import { isMobileApp, type ForemanState } from '@/lib/foreman/phase'
import type { PhaseSpec } from '@/lib/foreman/phases/spec'

// The step between an agent the user has agreed to and the agent being built. The offer itself is the
// app's: the moment the plan comes back confirmed it puts the trial card in the chat, and the moment
// the trial starts it builds the agent, neither of which waits on a model. Nothing can be typed here:
// the composer gives way to the trial the moment the card is up, otherwise this free model would
// answer anything for as long as they kept writing. The foreman only speaks when the card comes back
// without a plan, refused or still waiting on Stripe, once, to say what happens next.
export const TRIAL_PHASE: PhaseSpec = {
    phase: 'trial',
    instructions: state => {
        const plan = state.foreman.plan
        // Read back as what they saw on the card: paying for something described differently from
        // the card is how a trial gets cancelled the same day.
        const team = plan?.items.length ? `What they agreed to: ${plan.items.map(item => (item.kind === 'template' ? (item.title ?? item.slug) : item.kind === 'share' ? (item.name ?? 'a shared coworker') : item.name)).join(', ')}.` : ''
        const divisions = plan?.boxes?.length ? ` Laid out across ${plan.boxes.length} Boxes: ${plan.boxes.map(box => box.name).join(', ')}.` : ''

        if (isMobileApp(state)) return mobileAppInstructions(state, `${team}${divisions}`)

        return `Right now: their first coworker is agreed and nothing has been created. ${team}${divisions}

Their workspace has no plan, which is why nothing can exist yet: coworkers run on the machine of the workspace, and that machine is only claimed for an account with a plan. The trial card went up in the chat when they agreed: ${checkoutTerms(state)}

How to run this:
- The trial is not on yet: the card they tried was already used for a trial, or Stripe has not confirmed it yet. Say what happened in one or two short lines. They cannot write back: the message field is gone until the plan is on, so ask nothing.
- Right under your reply the app puts a button that reopens the card form: "Start free trial", or "Start my plan" when their card was already used for a trial. The coworker is built by itself the moment the plan is on. Point them to that button, never to a card further up the chat, and never tell them to refresh the page.
- Under the chat they also have a "Talk to the team" button for anything about paying. If the card form itself failed, call contact_team.
- Never invent a discount, a free plan or an exception, never answer anything beside the trial, and do not try to create a Box or a coworker: it will fail, and they will read the failure.`
    },
    tools: ['search_docs', 'contact_team'],
}

// In the app the card is a "Build my team" button that starts the trial without a card, and nothing
// about paying is ever said there: what can stop it is a trial already spent, which only the web can
// take further, or a hiccup the button simply retries.
function mobileAppInstructions(state: ForemanState, agreed: string): string {
    const blocked = state.trialSpent
        ? 'This workspace cannot be started from the app. Say so in one line, and that they can finish setting it up at rerun.build. Nothing else.'
        : 'The build did not start. Say in one line that it did not go through and that the "Build my team" button right under your reply tries again.'
    return `Right now: their first coworker is agreed and nothing has been created. ${agreed}

When they agreed, the app put a "Build my team" button in the chat, and it came back without the team being started. ${blocked}

They cannot write back here, so ask nothing. Never answer anything beside this, and do not try to create a Box or a coworker: it will fail, and they will read the failure.`
}
