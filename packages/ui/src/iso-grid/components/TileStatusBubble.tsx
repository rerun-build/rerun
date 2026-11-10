'use client'

import { memo, useEffect, useState } from 'react'
import { Badge } from '../../primitives/badge'
import { DEFAULT_SPAN, TILE_W, isoPosition, tileTopLift } from '../iso'
import type { Tile } from '../types'
import { useKitTranslations } from '../../locale'
import { tileStatusLabel } from '../status-label'

const ENTER_MS = 200
const EXIT_MS = 140

type Props = {
    // La tile survolée, null quand le curseur n'est sur rien. Une tile sans statut (au repos) vaut
    // null : elle n'a rien à dire.
    tile: Tile | null
    worldOffset: { left: number; top: number }
    reducedMotion?: boolean
}

// Ce que dit la couleur d'une tuile, au survol. Même ancrage que TileToastBubble, mais c'est le
// curseur qui tient la pastille en vie, pas un minuteur. Le ton reprend la teinte du bloc : c'est
// ce rapprochement qui apprend la couleur, pas le mot seul.
export const TileStatusBubble = memo(function TileStatusBubble({ tile, worldOffset, reducedMotion }: Props) {
    const t = useKitTranslations()
    const active = tile?.style.status ? tile : null
    // La tile effectivement peinte. Elle survit au départ du curseur le temps de la sortie :
    // démonter sur-le-champ ferait disparaître la pastille d'un coup.
    const [rendered, setRendered] = useState<Tile | null>(active)

    useEffect(() => {
        if (active) {
            setRendered(active)
            return
        }
        if (!rendered) return
        const timer = setTimeout(() => setRendered(null), reducedMotion ? 0 : EXIT_MS)
        return () => clearTimeout(timer)
    }, [active, rendered, reducedMotion])

    const status = rendered?.style.status
    if (!rendered || !status) return null

    const exiting = active === null
    const span = rendered.span ?? DEFAULT_SPAN
    const AW = span * TILE_W
    const pos = isoPosition(rendered.position.col, rendered.position.row)

    return (
        <div
            className="absolute pointer-events-none"
            style={{
                left: pos.left + worldOffset.left - TILE_W / 2,
                top: pos.top + worldOffset.top - tileTopLift(rendered.style, span),
                width: AW,
                zIndex: 99999,
            }}
        >
            {/* Élément de centrage : translateX(-50%) jamais animé → centrage stable. */}
            {/* Posée contre la pointe nord du bloc, pas au-dessus de lui : c'est une étiquette
                attachée à la tuile. Elle prend la place des badges `hand`/`lock`, que TileBlock
                efface pendant ce temps — deux signes pour un seul état se bousculent. */}
            <div className="absolute left-1/2" style={{ top: -24, transform: 'translateX(-50%)' }}>
                {/* Le fond `soft` du Badge n'est qu'une teinte à 12%, donc transparent : posé sur un
                    bloc de couleur, le mot devient illisible. La surface opaque est ce calque-ci, la
                    teinte du ton reste par-dessus. */}
                {/* `key` sur l'id : glisser d'une tuile à sa voisine rejoue l'entrée, au lieu de
                    téléporter la pastille sans un mot. */}
                <div
                    key={rendered.id}
                    className="inline-flex rounded-full bg-background/95"
                    style={{
                        animation: reducedMotion
                            ? undefined
                            : exiting
                              ? `iso-status-out ${EXIT_MS}ms ease-in forwards`
                              : `agent-toast-in ${ENTER_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                    }}
                >
                    {/* Une taille en dessous du plus petit Badge : la pastille se lit à côté du
                        label de 8px posé sur la face, pas à l'échelle d'une pastille de panneau. */}
                    <Badge tone={status.tone} size="xs" className="gap-0.5 px-1.5 py-px text-[8px]">
                        {tileStatusLabel(status, t)}
                    </Badge>
                </div>
            </div>
        </div>
    )
})
