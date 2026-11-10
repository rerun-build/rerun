import { FOREMAN_PHASES, type ForemanClient, type ForemanPhase, type TemplatePricing } from '@rerun/contracts'

import type { OnboardingAnswers } from '@/app/actions/onboarding'
import type { PriceArm } from '@rerun/cloud/billing'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import type { ForemanAgentRow, ForemanSpaceRow } from './board-map'
import type { KickoffIntent } from './kickoff-marker'

// Where the workspace stands, and therefore which foreman it talks to. A first arrival is walked by
// the hub from "who are you" to a built team; after that, `companion`, the hub is done and the
// foreman is the one on the workspace's engine (surface.ts). The phase decides both the instructions
// the hub reads and the tools it is handed, so the model cannot skip a step by deciding to: the tools
// of the next one are simply not there.
//
// Nothing here is a stored state machine. The phase is derived from what the workspace already has,
// so a user who closes the tab for three days, or finishes a step in another surface, comes back
// where they really are rather than where a counter said they were.

export { FOREMAN_PHASES, type ForemanPhase }

// `need` on an agent is the pain from the interview it answers, carried down to its first run.
// `asked` is what they wrote when they sent the card back for changes, word for word: the card
// keeps one line of it, and the agent needs the rest. `gets` and `delivered` are what the card
// promised it hands over, the shape its work has to come back in. `focus` on a template is the skill
// its install starts on: the use case of the starter card it was picked from.
export type ForemanPlanItem =
    | { kind: 'template'; slug: string; title?: string; focus?: string; box?: string }
    | { kind: 'agent'; name: string; role: string; need?: string; asked?: string; gets?: string[]; delivered?: string; box?: string }
    | { kind: 'share'; token: string; name?: string; box?: string }

// A division of the company, which becomes a Box on the board. Kept beside the items rather than
// derived from them, because the divisions that hold no agent yet are the whole point: they are what
// shows someone their company can be laid out here, while the trial only runs three agents.
export type ForemanPlanBox = { name: string; role?: string }

export type ForemanPlan = { title: string; items: ForemanPlanItem[]; boxes?: ForemanPlanBox[] }

// What the interview dug out for one job: what actually goes wrong there, and how they cope today.
export type ForemanNeed = { job: string; pain: string; today?: string }

// The foreman's own notes, kept in their own key of workspace_onboarding.answers so the fields the
// survey wrote keep their meaning for everything that still reads them (workspace naming, the
// lifecycle emails, the template category priority).
export type ForemanProfile = {
    profileAt?: string
    // The jobs they ticked on the discovery card, in the order they read on the form: one agent
    // each, unless two of them were merged and the plan said so.
    useCases?: string[]
    // Written with the first use case in it, never read directly: the rows already in production
    // carry it alone, and foremanUseCases is what knows which way the two read.
    pain?: string
    // What the interview dug out, one entry per job it got to. The plan and every agent's first
    // SOUL are written from it.
    needs?: ForemanNeed[]
    // Written by the interview before it dug per job, and still read for the rows that carry them.
    pains?: string[]
    challenge?: string
    // Stamped by the interview the starter pack replaced, and still read for the rows that carry it.
    interviewAt?: string
    language?: string
    plan?: ForemanPlan
    planAt?: string
    firstRunAt?: string
    // They came in on a link and what it carries was installed before anyone asked who they are.
    // Written with the plan, and what sends them to the welcome card once the build is done instead
    // of before it. Its own mark rather than "built with no profile": rows from before it hold that
    // too, and those are companions.
    installedFirst?: boolean
    // Where the trial was started. The app starts every trial without a card, whatever the arm of the
    // trial test, so the test's table leaves those workspaces out.
    trialStartedIn?: ForemanClient
}

// What this person asked to have taken off their hands, whichever era their profile was written in.
// A profile from before the multiple selection answers with a list of one, so everything downstream
// has a single shape to know.
export function foremanUseCases(foreman: ForemanProfile): string[] {
    if (foreman.useCases?.length) return foreman.useCases
    return foreman.pain ? [foreman.pain] : []
}

export type ForemanAnswers = OnboardingAnswers & { foreman?: ForemanProfile }

// What the user arrived with is mostly kept out of here: a link says what someone wants, never where
// their workspace stands. The one exception is `arrivedReadyMade`, which installs it first.
export type PhaseInput = {
    foreman: ForemanProfile
    onboardingCompletedAt: string | null
    entitled: boolean
    // On a trial: entitled since the card went in, which says nothing of a team being there.
    trialing?: boolean
    agentCount: number
    // No machine for this workspace and none left in the pool. Only ever true for a real account
    // that has not got past the funnel, and only read by the loader that asked the pool.
    waitlisted?: boolean
    // Arrived on a template or a share link the server could still put a name on. Only then is it
    // installed before the welcome card: a link nobody can read has nothing to install.
    arrivedReadyMade?: boolean
    // The hub has a key to run the onboarding on. A self-hosted install without one skips it: its
    // foreman runs on the engine, on whatever AI the user connects there.
    hubForeman?: boolean
}

export function foremanPhase({ foreman, onboardingCompletedAt, entitled, trialing = false, agentCount, waitlisted = false, arrivedReadyMade = false, hubForeman = true }: PhaseInput): ForemanPhase {
    if (!hubForeman) return 'companion'

    // Being in the funnel is a workspace fact: discovery happened, or a team was agreed. Reading the
    // plan here and not just the profile is what keeps a conversation that never got a profile
    // written inside the funnel past its own checkout: `entitled` flips true there, and the funnel
    // would otherwise end one step before the build it exists for.
    const inFunnel = !!foreman.profileAt || !!foreman.plan

    // Entering the funnel is the one decision that cannot be undone by deriving it again later, so
    // it is refused to any workspace that is already running: a paying account, one that holds
    // agents, or one that went through the old survey is talking to a companion, not a guide. On a
    // self-hosted install every workspace is entitled from its first minute, which says nothing of
    // whether it is running, and neither does a trial started from a paywall the Foreman never showed.
    if (!inFunnel && ((RERUN_CLOUD && entitled && !trialing) || agentCount > 0 || onboardingCompletedAt)) return 'companion'

    // What a ready-made arrival still owes once its coworker is on the board: the welcome card it
    // was let past on the way in.
    const owesProfile = !!foreman.installedFirst && !foreman.profileAt

    // Once the team is built the funnel is over for good. Without this the owner who deletes their
    // last agent would be walked through the build phase again.
    if (foreman.firstRunAt) return owesProfile ? 'discover' : 'companion'

    // The pool is empty: whatever step they stand on, nothing past this point is worth a token
    // until a machine can be claimed. Before `discover` on purpose, so a brand-new account is
    // stopped before the welcome card, not after the interview.
    if (waitlisted) return 'waitlist'

    // A first arrival starts by getting to know them, with one exception: someone who clicked a
    // template or a shared coworker came for that, so it is installed first and the welcome card
    // waits behind the build. The plan is then the link itself, written by the app (scripted.ts).
    if (!inFunnel) return arrivedReadyMade ? 'plan' : 'discover'

    // No interview: the welcome card settled their industry, and the plan is its starter pack, picked
    // off the cards rather than asked about (scripted.ts).
    if (!foreman.plan) return 'plan'
    if (!entitled) return 'trial'
    if (agentCount === 0) return 'build'
    return owesProfile ? 'discover' : 'companion'
}

// An intent the server has been able to put a name on, so the prompt can say what the user arrived
// with rather than repeating a slug back at them. `description` is the sentence the model reads;
// `title` is the short one, for the surfaces that only have a line to say it in.
// `paid` is the pricing of a template the workspace still has to buy before it can be installed,
// written out by the card that shows it, in the reader's language.
// `coworker` is the one coworker a template installs, when it installs exactly one: the name the
// arrival speaks of, where a template's title reads as a sentence.
export type ArrivingIntent = KickoffIntent & { description?: string; title?: string; paid?: TemplatePricing; coworker?: string }

export function isReadyMade(intent: KickoffIntent | null): boolean {
    return intent?.kind === 'template' || intent?.kind === 'share'
}

/** A ready-made link the server resolved: only those are installed ahead of the welcome card. */
export function isNamedReadyMade(intent: ArrivingIntent | null): boolean {
    return isReadyMade(intent) && !!intent?.title
}

/** What a workspace installed from the link it arrived on, read back from the plan it was written as. */
export function installedArrival(foreman: ForemanProfile): ForemanArrival | null {
    if (!foreman.installedFirst) return null
    const [item] = foreman.plan?.items ?? []
    if (item?.kind === 'template' && item.title) return { kind: 'template', title: item.title }
    if (item?.kind === 'share' && item.name) return { kind: 'share', title: item.name }
    return null
}

/** What the welcome card names above its first question. Only the arrivals that carry a ready-made thing. */
// `installed` once it is on the board and the card is the last thing left to answer.
export type ForemanArrival = { kind: 'template' | 'share'; title: string; installed?: boolean; paid?: TemplatePricing; coworker?: string }

// Which loop serves a conversation: the hub's own for the onboarding, or the foreman agent on the
// workspace's engine for everything after. Fixed when the conversation starts.
export type ForemanBackend = 'hub' | 'engine'

export type ForemanState = {
    phase: ForemanPhase
    intent: ArrivingIntent | null
    answers: ForemanAnswers
    foreman: ForemanProfile
    // Carried rather than dropped after the phase is resolved: a turn that calls save_profile has to
    // resolve the phase again, with the stamp that call just wrote.
    onboardingCompletedAt: string | null
    firstName: string
    language: string | null
    entitled: boolean
    trialing?: boolean
    // The one free trial is gone: a workspace that is not entitled then has to be billed today, and
    // saying "free" to it is the promise the checkout breaks on the next screen.
    trialSpent: boolean
    // The card arm of the trial test: the trial is still free, but it starts through the card form.
    trialNeedsCard: boolean
    // The price the workspace is sold the base plan at, which the trial phase quotes.
    priceArm: PriceArm
    client: ForemanClient
    workspaceName: string
    workspacePlan: string
    userEmail: string | null
    spaces: ForemanSpaceRow[]
    agents: ForemanAgentRow[]
    // Boxes of the workspace the person is not open to, left out of `spaces`, and whether that
    // person is a member rather than an admin.
    hiddenBoxes?: number
    isMember?: boolean
}
