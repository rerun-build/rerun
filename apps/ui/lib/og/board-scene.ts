import 'server-only'

import type { TemplateConnector } from '@rerun/contracts'
import type { BoardAgent } from '@rerun/ui/iso-grid'
import { CARD_HEIGHT, CARD_MAX_ZOOM, CARD_WIDTH } from '@rerun/ui/iso-grid/card-capture'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { loadServiceCatalog } from '@/lib/templates/catalog'

import type { AlertBoard } from './alert-board'
import { boardAgentsOfScene, type BoardImageRequest, type BoardImageScene } from './board-image'

export type StagedBoardScene = { agents: BoardAgent[]; connectors: TemplateConnector[]; highlightedConnectorSlugs: string[] }

// A scene names its apps by slug only. A slug the catalog does not know is dropped rather than
// drawn as a blank tile: the picture goes out in a message, where nobody can hover it for a name.
export async function stageBoardScene(supabase: SupabaseClient<Database>, scene: Exclude<BoardImageScene, AlertBoard>): Promise<StagedBoardScene> {
    const slugs = [...new Set(scene.agents.flatMap(agent => agent.connectors ?? []))]
    const catalog = slugs.length > 0 ? await loadServiceCatalog(supabase, slugs) : new Map()

    return {
        agents: boardAgentsOfScene(scene, new Set(catalog.keys())),
        connectors: slugs.flatMap(slug => {
            const entry = catalog.get(slug)
            return entry ? [{ slug, name: entry.name, icon: entry.icon }] : []
        }),
        highlightedConnectorSlugs: scene.highlight ?? [],
    }
}

// The icon of the app a coworker waits for. An app the catalog does not know has no tile.
export async function alertAppIcon(supabase: SupabaseClient<Database>, board: AlertBoard): Promise<string | null> {
    if (board.kind !== 'coworker' || !board.app) return null
    const catalog = await loadServiceCatalog(supabase, [board.app])
    return catalog.get(board.app)?.icon ?? null
}

// The card zoom is tuned for the card frame: scaled with the frame, a board keeps the same share of
// the picture whatever size is asked for.
export function boardImageMaxZoom({ width, height, zoom }: Pick<BoardImageRequest, 'width' | 'height' | 'zoom'>): number {
    return zoom ?? CARD_MAX_ZOOM * Math.min(width / CARD_WIDTH, height / CARD_HEIGHT)
}
