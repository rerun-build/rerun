import 'server-only'

import { agentsFromRow, connectorsFromRow } from '@/lib/templates/document'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { readAgentShare } from '@/lib/agents/share-read'
import { selectMany, selectMaybeSingle } from '@/supabase/supabase-helpers'
import { arrivalOf, BOARD_TEMPLATE_SLUGS, starterTeams, templateTeam, type BoardTeam, type BoardTeams } from './board-teams'

const BOARD_COLUMNS = ['slug', 'agents', 'connectors'] as const

// The sign-in page draws them for every visitor, and the starter packs change with a deploy, not
// with a request: one read per process every few minutes is plenty.
const TTL_MS = 10 * 60 * 1000
let cached: { at: number; teams: Promise<BoardTeams> } | null = null

async function readStarterTeams(): Promise<BoardTeams> {
    const { data } = await selectMany(createServiceRoleClient(), 'templates', BOARD_COLUMNS, { slug: BOARD_TEMPLATE_SLUGS, status: 'published' })
    return starterTeams((data ?? []).map(row => ({ slug: row.slug, agents: agentsFromRow.parse(row.agents), connectors: connectorsFromRow.parse(row.connectors) })))
}

// An empty read is not kept: the templates of a fresh install land after its first page was drawn.
export function loadStarterTeams(): Promise<BoardTeams> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.teams
    const teams = readStarterTeams().then(
        read => {
            if (!read.showcase.agents.length) cached = null
            return read
        },
        err => {
            cached = null
            console.error('Failed to read the onboarding board teams', err)
            return starterTeams([])
        }
    )
    cached = { at: Date.now(), teams }
    return teams
}

// Someone who arrived on a template or a shared coworker sees it on the board from the sign-in on,
// instead of the team of an industry. A link that no longer resolves leaves the board to the rest.
export async function loadArrivalTeam(next: string | null | undefined): Promise<BoardTeam | null> {
    const arrival = arrivalOf(next)
    if (!arrival) return null
    const supabase = createServiceRoleClient()
    if (arrival.kind === 'share') {
        const preview = await readAgentShare(supabase, arrival.token)
        return preview ? templateTeam({ slug: 'share', agents: [preview.agent], connectors: preview.connectors }) : null
    }
    const { data } = await selectMaybeSingle(supabase, 'templates', BOARD_COLUMNS, { slug: arrival.slug, status: ['published', 'unlisted'] })
    if (!data) return null
    const team = templateTeam({ slug: data.slug, agents: agentsFromRow.parse(data.agents), connectors: connectorsFromRow.parse(data.connectors) })
    return team.agents.length ? team : null
}
