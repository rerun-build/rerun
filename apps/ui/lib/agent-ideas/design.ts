import { z } from 'zod'

import { VOICE } from '@/lib/templates/voice'
import { brandText } from '@/lib/brand/text'
import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { AGENT_CAPABILITIES } from './capabilities'
import { evidenceForPrompt } from './evidence'
import { generateIdeasObject } from './model'
import { LENSES, type AgentCandidate, type CatalogApp, type CompanyDossier, type Opportunity } from './types'

const SUMMARY_CHARS = 70

const designSchema = z.object({
    candidates: z
        .array(
            z.object({
                name: z.string().describe('Two or three words, the job as a title: "Review Responder", "Quote Chaser"'),
                role: z.string().describe('One plain line of twelve words at most that starts with a verb and names the real things it works on'),
                hook: z.string().describe('One sentence said to the owner, stating the fact about their company that makes this coworker worth having. No pitch, no question.'),
                lens: z.enum(LENSES),
                evidenceIds: z.array(z.string()).min(1).describe('Ids of the facts the hook and the job rest on'),
                steps: z.array(z.string()).length(3).describe('What it does in one run, three concrete steps in order'),
                when: z.string().describe('When it runs: "Every Monday at 8", "When a review is posted"'),
                connectors: z.array(z.string()).max(4).describe('Slugs from the list of available apps, only the ones this job cannot run without'),
                missingApps: z.array(z.string()).describe('Apps the job needs that are not in the list, by name. Empty when none.'),
                firstRun: z.string().describe('What the owner holds in their hands after the very first run, in one sentence'),
                kickoff: z.string().describe('The first message the owner would write to this coworker to start it: first person, two sentences at most, the job and its one concrete outcome, naming the real things it works on. No greeting, no preamble.'),
            })
        )
        .min(6)
        .max(15),
})

const SYSTEM = `${VOICE}

Here you are not writing a template. You are designing coworkers made to measure for one company, from the recurring work an analyst found there and the numbered facts behind it.

Rules for every coworker:
- One coworker, one job. A coworker that "manages marketing" is three coworkers and none.
- It must be false for a competitor. If the card could be handed unchanged to another company of the same industry, redo it from a fact only this company has: a product, a named competitor, a customer, a tool, a number, the role of the person.
- The hook states a fact, and every fact comes from the list. Never invent a number, a name or an event. If the list does not say how many, do not say how many.
- Only promise what a coworker can do, and only with apps from the list. When the job needs an app that is not there, name it in missingApps rather than pretending.
- Prefer the apps the facts say the company already uses.
- Never repeat a coworker they already have, and never propose two coworkers doing the same job.
- Spread across the business: several functions, not five variations on content.

${AGENT_CAPABILITIES}`

function describeOpportunity(opportunity: Opportunity, index: number): string {
    return `${index + 1}. [${opportunity.lens}] ${opportunity.job}\n   Who: ${opportunity.who}. When: ${opportunity.cadence}. Where: ${opportunity.tool || 'no app named'}. Cost today: ${opportunity.friction}. Facts: ${opportunity.evidenceIds.join(', ')}`
}

function describeApp(app: CatalogApp): string {
    return `${app.slug} | ${app.name} | ${app.category} | ${app.summary.slice(0, SUMMARY_CHARS)}`
}

function prompt(dossier: CompanyDossier, opportunities: Opportunity[], catalog: CatalogApp[]): string {
    return [`Company: ${dossier.companyName ?? 'unknown name'}`, dossier.existingAgents.length ? `Coworkers they already have:\n${dossier.existingAgents.map(agent => `- ${agent.name}: ${agent.description}`).join('\n')}` : 'They have no coworker yet.', `Recurring work found:\n${opportunities.map(describeOpportunity).join('\n')}`, `Facts:\n${evidenceForPrompt(dossier.evidence)}`, `Available apps (slug | name | category | what it is):\n${catalog.map(describeApp).join('\n')}`].join('\n\n')
}

export async function design(dossier: CompanyDossier, opportunities: Opportunity[], catalog: CatalogApp[], brand: Brand = RERUN_BRAND) {
    const { object, cost } = await generateIdeasObject({ schema: designSchema, system: brandText(SYSTEM, brand), prompt: prompt(dossier, opportunities, catalog) })
    return { candidates: object.candidates satisfies AgentCandidate[], cost }
}
