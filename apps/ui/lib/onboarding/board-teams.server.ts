import 'server-only'

import { agentsFromRow, connectorsFromRow } from '@/lib/templates/document'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMany } from '@/supabase/supabase-helpers'
import { BOARD_TEMPLATE_SLUGS, starterTeams, type BoardTeams } from './board-teams'

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
