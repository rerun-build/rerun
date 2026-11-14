import 'server-only'

import type { TemplateConnector } from '@rerun/contracts'
import type { BoardAgent } from '@rerun/ui/iso-grid'
import { CARD_HEIGHT, CARD_MAX_ZOOM, CARD_WIDTH } from '@rerun/ui/iso-grid/card-capture'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/app/api/database.types'
import { loadServiceCatalog } from '@/lib/templates/catalog'

import { boardAgentsOfScene, type BoardImageRequest } from './board-image'

export type StagedBoardScene = { agents: BoardAgent[]; connectors: TemplateConnector[]; highlightedConnectorSlugs: string[] }

export async function stageBoardScene(supabase: SupabaseClient<Database>, scene: BoardImageRequest['scene']): Promise<StagedBoardScene> {
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

export function boardImageMaxZoom({ width, height, zoom }: Pick<BoardImageRequest, 'width' | 'height' | 'zoom'>): number {
    return zoom ?? CARD_MAX_ZOOM * Math.min(width / CARD_WIDTH, height / CARD_HEIGHT)
}
