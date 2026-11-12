import type { UIMessage } from 'ai'

import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { intakeBoxes } from '@/lib/onboarding/intake'
import { describeNeed } from '../needs'
import { foremanUseCases, isMobileApp } from '../phase'
import type { ForemanState } from '../phase'
import { lastShownPlan } from '../shown-plan'
import type { PlanItemKind } from '../tool-defs'
import type { PhaseSpec } from './spec'

const BESPOKE_TOOLS = ['ask_choice', 'ask_input', 'search_docs', 'show_plan', 'save_profile', 'contact_team'] as const

// A template is never offered, only honoured: it exists on this belt for the one person who clicked
// a library card before signing up, and for nobody else.
export function arrivedOnATemplate(state: ForemanState): boolean {
    return state.intent?.kind === 'template' || state.intent?.kind === 'share'
}

// The welcome card has already read their site into the profile. Handed the reader again, the model
// reads it a second time before every card, one more round trip for what the prompt already says.
export function siteLeftUnread(state: ForemanState): boolean {
    return Boolean(state.answers.company_url) && !state.answers.company_offering
}

// The shapes a plan item is allowed to take, for the same reason and on the same rule as the belt:
// a kind the model never reads about is a kind it cannot write down, and a plan without a template
// item is a build phase that never gets install_template back.
export function planKinds(state: ForemanState): readonly PlanItemKind[] {
    if (state.intent?.kind === 'template') return ['agent', 'template']
    if (state.intent?.kind === 'share') return ['agent', 'share']
    return ['agent']
}

// The divisions the welcome card drew on the board, and the only ones a first plan lays out: the
// model files agents into them and never draws its own, so the board does not redraw itself under
// someone who has not agreed to anything yet. A link lands in one of them and leaves the others
// standing.
export function pinnedPlanBoxes(state: ForemanState): string[] {
    return intakeBoxes(state.answers.industry)
}

// A self-hosted install has no template library, so no starter pack opens this step and the model
// writes the first card. A model that only announces the card would leave a new workspace with
// nothing to click.
export function forcesFirstPlan(state: ForemanState, messages: UIMessage[]): boolean {
    return !RERUN_CLOUD && state.phase === 'plan' && !state.intent && !!state.foreman.profileAt && lastShownPlan(messages) === null
}

// What to build, decided out loud with the user and written down before anything is paid for.
export const PLAN_PHASE: PhaseSpec = {
    phase: 'plan',
    instructions: state => {
        // Ce que l'interview a tiré d'eux : c'est la seule chose de ce prompt qu'ils ont dite
        // eux-mêmes, donc elle fait foi. Vide seulement pour un profil passé à côté de l'interview.
        const picked = foremanUseCases(state.foreman)
        // One agent, so one job and its one pain. A profile written when the interview took several
        // jobs keeps its first, the one they ticked first.
        const job = picked[0]
        const needs = (state.foreman.needs ?? []).filter((need, index, all) => (all.some(other => other.job === job) ? need.job === job : index === 0)).slice(0, 1)
        const pains = state.foreman.pains ?? []
        const matter = needs.length
            ? [`what goes wrong in that job (${needs.map(describeNeed).join('; ')})`]
            : [pains.length ? `what slows them down (${pains.join('; ')})` : null, state.foreman.challenge ? `what they are up against right now (${state.foreman.challenge})` : null].filter(Boolean)

        // Everyone has been through the welcome card by now, whatever link brought them here, so the
        // profile is filled and nothing asks for it again. What a link changes is only what this
        // step starts from. A profile that is still empty means the card failed: save_profile is
        // still on the belt, because it is what names the workspace and stamps the onboarding the
        // lifecycle emails key off.
        const websiteName = state.intent?.kind === 'prompt' ? state.intent.name : undefined
        const arrival =
            state.intent?.kind === 'template'
                ? `They came in on a link to a ready-made template, so start from that rather than from your own idea. One line in their language saying what it will do for their company, then show_templates with that template alone, allow_custom on, and \`box\` set to the Box of their board its work belongs to. That card is the whole plan: picking it writes it down and moves on by itself. Never follow it with show_plan, and never ask whether it suits them, what it should handle first or what to change: the card already asks, and the template's own setup asks the rest once it is installed. If they pick "Build something for me" or ask for something else instead, drop it and design one coworker for them yourself, read back with show_plan.`
                : state.intent?.kind === 'share'
                  ? `They came in on a link to a shared coworker, so start from that rather than from your own idea: read it back straight away with show_plan, one item of kind share with its token, in the Box of their board its work belongs to. The card is how they say yes or ask for something else, so ask nothing before it. If they ask for something else instead, drop it and design one coworker for them yourself.`
                  : state.intent
                    ? `They said what they wanted before they ever opened Rerun, and it is written above: design the coworker their own words call for rather than your own idea of their business. If they wrote when it should run, that is its \`when\`.${websiteName ? ` Name it "${websiteName}" on the card, the name it already carried on the website, unless they ask for another.` : ''} There is nothing ready-made to install here, the coworker of this plan is one you write for them.`
                    : `Design the coworker yourself, out of what you already know about them. There is no catalog to browse and nothing for them to pick from: they told you what they need, your job is to turn it into one coworker at work in their company. It is one you write for them, from their own words; there is nothing ready-made to install here.`

        // Arriving on a link, the agents are the ones on the other side of it. Every rule below about
        // working the agent out is about inventing one, and read
        // beside a template it is an invitation to pad it.
        const agents = arrivedOnATemplate(state)
            ? ['The coworkers are the ones that come with it and nothing else. Do not write a coworker item beside it, not even one for a Box that would otherwise stay empty.']
            : [
                  picked.length
                      ? `Then the coworker, and there is exactly one: the one that takes on the job they named in the interview, ${job}.${websiteName ? '' : ' Name it after the result it gets them, in their own words rather than after the division it sits in, and never with a word that already means something inside Rerun like Onboarding, Setup or Install: on their board it would read as part of this product rather than of their company.'}${matter.length ? ` Write its role against ${matter.join(' and ')}: that is what makes the coworker theirs.` : ''}${needs.length ? ' Put the pain of its job in its need, in their words: it is what the coworker goes after the first time it works.' : ''} A coworker that could belong to any company is the line they read twice and the plan they leave over.`
                      : 'Then the coworker, and there is exactly one. Nobody has named its job for you: work it out yourself from what their site actually does, what their line of business spends its week on, and the job title they gave. Take the piece of work this company visibly does every week that their own role touches daily, written as the job rather than as the tool, "answer the demo requests coming off the pricing page" and never "CRM". A coworker that could belong to any company is the line they read twice and the plan they leave over.',
                  'Say what it is for in their terms, not yours, and never tell them you guessed. If it is wrong, the card is where they will say so.',
                  'One coworker and never a second, whatever else you can see they would need: it is built the moment they confirm, then sets itself up with them in its own chat. The rest of their team comes once this one works, and offering it now is the choice that loses them. Say in one line above the card what this coworker will take off their plate.',
              ]
        // Everyone keeps the divisions the welcome card drew, and the model only fills them.
        const fixedBoxes = `Their company is already laid out on the board beside you, in these Boxes: ${pinnedPlanBoxes(state).join(', ')}. They are fixed: never add, rename, drop or reorder one.`
        const layout =
            state.intent?.kind === 'template'
                ? [`${fixedBoxes} Set \`box\` on show_templates to the one its work belongs to; the others stay on the board, empty, for later.`]
                : [
                      `${fixedBoxes} Your whole job is the agent: file it under the Box its work belongs to, with \`box\`. The other Boxes stay on the board, empty, for later: never invent a coworker to fill one.`,
                      'Propose, do not make them choose. Write the coworker down and read it back with show_plan in this same turn. A blank page handed to someone who has been using Rerun for four minutes is the one thing that loses them.',
                  ]
        const nameIt = websiteName ? '' : 'Name it after its job in one or two English words, like Enquiries or Outreach. '
        const naming = arrivedOnATemplate(state) ? [] : [nameIt + 'The card is read in seconds: its `role` is one plain line of twelve words at most, starting with a verb and naming what it hands over, and its `when` says what sets it off or how often, in a few words. No metaphor, no clever phrasing, no dash: "Writes the case study for each finished project", never "what the studio shipped, told outward". Its `beats` are one ordinary run of it at their company, three lines of five words at most, and its `gets` three plain lines on what it hands them this week.']

        return `Right now: you know what this person wants, and their workspace is still empty. This turn is about agreeing on what to build for them.

How to run this:
- The card is a first draft they will correct in seconds. Take the first layout that fits and write it down: do not weigh alternatives, do not reorder it, do not rename anything twice.
- ${arrival}
${[...layout, ...agents].map(line => `- ${line}`).join('\n')}
${naming.map(line => `- ${line}\n`).join('')}- A coworker is a name and a job here, never a list of apps. Do not look up what it would plug into and do not name a tool on the card: the apps are settled by the coworker itself the first time it works, in its own chat, and a plan that promises a connection nobody has signed into yet is a plan that reads as already half broken.
- The card is written in English whatever language you speak with them: Box names, coworker names, \`role\` and \`when\` alike. Only your line above it is in their language.
- show_plan lets them rename the coworker or change its job: it is theirs, and this is the moment it costs nothing. If they ask for a second coworker, say in one line that more come once this one works, and keep the card to one. If they ask to change a Box, say in one line they can rearrange their Boxes on the board once it is built, and change only the coworker.
- The card coming back confirmed closes this step on its own: the app writes the plan down and takes it from there, so a confirmation never reaches you. If they asked for changes instead, adjust and show the card again.
- ${
            state.entitled
                ? 'Do not create anything yet, and do not claim anything is running: nothing is built before the plan comes back confirmed. The moment it does, the app builds it, on the plan their account is already on, with no payment asked for.'
                : isMobileApp(state) && state.storeBilling
                  ? 'Do not create anything yet, and do not claim anything is running: nothing is built before the card comes back confirmed. The moment it does, the app puts the free week of the plan in front of them, through their store, then builds the coworker.'
                  : isMobileApp(state)
                  ? 'Do not create anything yet, and do not claim anything is running: nothing is built before the card comes back confirmed. The moment it does, the app asks them to start the build, then builds the coworker.'
                  : 'Do not create anything yet, and do not claim anything is running: their workspace has no plan, so no Box and no coworker can exist. The moment the card comes back confirmed, the app puts the free trial in front of them, then builds the coworker.'
        }`
    },
    tools: state => [...BESPOKE_TOOLS, ...(siteLeftUnread(state) ? (['analyze_website'] as const) : []), ...(arrivedOnATemplate(state) ? (['show_templates', 'open_template_card'] as const) : [])],
}
