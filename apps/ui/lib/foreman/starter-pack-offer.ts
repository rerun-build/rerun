import 'server-only'

import { generateObject } from 'ai'
import { z } from 'zod'

import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import { hasOpenRouterKey, openrouter } from '@/lib/ai/openrouter'
import { starterPack } from '@/lib/onboarding/starter-packs'
import { templateCardImage } from '@/lib/templates/card-image'
import { LIBRARY_COLUMNS, toLibraryTemplates, type LibraryRow } from '@/lib/templates/library'
import { selectMany } from '@/supabase/supabase-helpers'
import type { ForemanState } from './phase'
import { pinnedPlanBoxes } from './phases'
import type { StarterPackInput } from './starter-pack'

const NAMING_MODEL = process.env.RERUN_STARTER_NAMING_MODEL ?? 'anthropic/claude-haiku-4.5'
const NAMING_TIMEOUT_MS = 8000
const MAX_ROLE = 90

/**
 * The starter pack of their industry, as the card draws it. Only what installs on the trial alone
 * makes it onto the rail: a template not published yet, one with no captured coworker, or a paid one
 * would be a card that breaks the build it promises. `null` when nothing is left, and the model
 * designs their coworker instead.
 */
export async function loadStarterPack(ctx: WorkspaceContext, state: ForemanState): Promise<StarterPackInput | null> {
    const cards = starterPack(state.answers.industry, state.answers.onboarding?.sector)
    const { data } = await selectMany(ctx.supabase, 'templates', LIBRARY_COLUMNS, { slug: cards.map(card => card.template), status: 'published' })
    const bySlug = new Map(
        toLibraryTemplates((data ?? []) as LibraryRow[])
            .filter(template => template.pricing.model === 'free' && template.archiveAgentNames.length > 0)
            .map(template => [template.slug, template]),
    )

    const shown = cards.flatMap(card => {
        const template = bySlug.get(card.template)
        if (!template) return []
        return [
            {
                slug: template.slug,
                promise: card.promise,
                line: card.line ?? template.tagline,
                ...(card.focus ? { focus: card.focus } : {}),
                title: template.title,
                agent: template.archiveAgentNames[0],
                image: templateCardImage(template),
                connectors: template.connectors.map(connector => connector.slug),
            },
        ]
    })
    if (!shown.length) return null

    const pinned = pinnedPlanBoxes(state)
    return { cards: shown, box: pinned[0], boxes: pinned.map(name => ({ name })) }
}

const namingSchema = z.object({
    name: z.string().describe('One or two English words naming the job, like Enquiries or Outreach. Never Onboarding, Setup or Install.'),
    role: z.string().describe('One plain line of twelve words at most, starting with a verb, naming what it hands over.'),
})

function fallbackName(asked: string): { name: string; role: string } {
    const line = asked.replace(/\s+/g, ' ').trim()
    return { name: 'Coworker', role: line.length > MAX_ROLE ? `${line.slice(0, MAX_ROLE - 1).trimEnd()}…` : line }
}

/** A name and a role for the one coworker they described in their own words instead of picking. */
export async function nameCustomCoworker(asked: string): Promise<{ name: string; role: string }> {
    if (!hasOpenRouterKey()) return fallbackName(asked)
    try {
        const { object } = await generateObject({
            model: openrouter(NAMING_MODEL),
            schema: namingSchema,
            system: 'You name the one AI coworker a person just described, for the card of their new team. English only, whatever language they wrote in. No metaphor, no dash, no quotes.',
            prompt: asked,
            temperature: 0,
            abortSignal: AbortSignal.timeout(NAMING_TIMEOUT_MS),
        })
        const name = object.name.trim()
        const role = object.role.trim()
        return name && role ? { name, role } : fallbackName(asked)
    } catch (err) {
        console.error('[foreman] naming the custom coworker failed', err instanceof Error ? err.message : err)
        return fallbackName(asked)
    }
}
