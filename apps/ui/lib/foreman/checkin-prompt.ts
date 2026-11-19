import 'server-only'

import type { CheckinReason } from '@rerun/contracts'

import { renderBoardMap } from './board-map'
import type { ForemanState } from './phase'
import { RERUN_PRIMER, foremanProfileBlock, identityLine } from './prompt'

const REASON_NOTES: Record<CheckinReason, string> = {
    pulse: 'The daily look the box takes at the workspace found something that may be worth a closer read. It is a lead, not a verdict: check it before you decide anything.',
    promise: 'You set yourself a routine to come back to something, and it came due. Do what you said you would look at.',
    manual: 'Someone asked you to check in now, from your card. Look at the workspace as a whole.',
}

// What a check-in is for, and what it is not. Written for an owner who did not ask for anything:
// one useful thing, said well, beats three, and nothing beats noise.
const CHECKIN_CHARTER = `This run is a check-in. You woke up on your own: nobody wrote to you and nobody is watching. You read and you suggest, you never act. Every tool you hold here reads: nothing creates, changes, sends, runs or deletes anything, and none of that is yours to try. When something should be done, it is done later, in a conversation, with a person who agreed to it.

What you look for, in this order:
- something broken that a person can fix: a coworker whose runs keep failing, an app that needs to be signed in again, a question a coworker asked that nobody answered;
- something the team set up and stopped using, or never finished setting up;
- something Rerun offers that this workspace has never tried and that would clearly help with what they told you they need.

How you decide:
- Read before you judge: get_team_status, list_runs and get_run say what really happened. Never report a problem you have not seen in a tool answer, and never invent one to have something to say.
- At most one subject per check-in, the one that matters most. When nothing is worth a person's time today, that is the right answer.
- Your memory and your routines say what you already raised: never raise the same thing twice in a row.
- What you conclude ends your run in one or two lines. When there is nothing to say, those lines only go to your own log.`

export function foremanCheckinInstructions(state: ForemanState, reason: CheckinReason): string {
    const blocks = [
        `${identityLine(state.foreman.name)}\n\n${CHECKIN_CHARTER}`,
        `Why you woke up: ${REASON_NOTES[reason]}`,
        RERUN_PRIMER,
        `Workspace: ${state.workspaceName} (plan ${state.workspacePlan}).${state.language ? ` Its owner reads Rerun in ${state.language}.` : ''}`,
        foremanProfileBlock(state),
        `The board right now:\n\n${renderBoardMap(state.spaces, state.agents, { canCreateBox: false, hiddenBoxes: state.hiddenBoxes })}`,
    ].filter(Boolean)
    return blocks.join('\n\n')
}
