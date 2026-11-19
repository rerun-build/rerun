import { SPACE_COLOR, agentTileStyle, type Container, type GridPosition, type Tile } from '@rerun/ui/iso-grid'

import type { PlanGroup, ShownPlan } from '@/components/foreman/widgets/plan-card'
import { AGENT_SPAN } from '@/lib/board/iso'
import { findRadialRect, type NewSpaceRect, type SpaceRect } from '@/lib/board/space-layout'

// The plan drawn on the board, before anything is created.
//
// The whole point is that it lands where the real thing will: the Boxes are placed by replaying
// `findRadialRect` in the order of the plan, which is literally what `createBoxes` does, and the
// agents fill their Box the way `findFreeCellInSpace` fills it, from the north corner, two cells at
// a time. So the preview is not an illustration of the plan, it is the board the plan produces, and
// when the real Boxes land they land exactly on their own ghost.
//
// Pure and deterministic: the module has to render the same scene twice in a row for a tile to keep
// the entrance it was mounted with instead of replaying it.

export type PlanScene = {
    containers: Container[]
    tiles: Tile[]
    /** Ms after mount when the last tile has finished falling, which is when the scene can settle. */
    landedAt: number
}

// What a screen reader hears for a piece of the scene, in the reader's language (usePlanSceneLabels).
// Left out, it hears the bare names.
export type PlanSceneLabels = { planned: (name: string) => string; plannedBox: string }

const BARE_NAMES: PlanSceneLabels = { planned: name => name, plannedBox: '' }

export type PlanSceneOptions = {
    /** False under reduced motion: the scene is simply there. */
    animated?: boolean
    labels?: PlanSceneLabels
    /**
     * The Boxes that exist for real. They keep their place in the rosette, which is what makes the
     * ones after them fall where the server will put them, but they are no longer drawn: the real
     * Box has taken over exactly on top, so the preview clears itself one division at a time
     * instead of vanishing whole at the first.
     */
    built?: SpaceRect[]
}

const BOX_DRAW_MS = 900
const BOX_STEP = 420
// The agents of a Box start falling while its outline is still being drawn: waiting for the floor
// makes each division a separate little scene instead of one board being built.
const AGENT_LAG = BOX_DRAW_MS * 0.55
const AGENT_STEP = 120
// `agent-drop-in` is a fixed 1s in the package's stylesheet.
const TILE_DROP_MS = 1000

// Ce qui dit « pas encore construit » une fois tout posé. La tuile garde sa couleur et son nom,
// donc on reconnaît l'agent qu'elle sera, mais elle perd ce qui fait un objet réel : le reflet de
// sa matière s'éteint, sa face se hachure et elle s'efface presque. C'est la langue que le board
// parle déjà pour un bloc en cours de placement et pour un agent éteint.
const PREVIEW_TILE_OPACITY = 0.5

/** Ce qui distingue une pièce de l'aperçu d'une vraie, partout où le board les mélange. */
export const PLAN_PREVIEW_PREFIX = 'plan-preview:'

export function isPlanPreviewId(id: string | null | undefined): boolean {
    return !!id?.startsWith(PLAN_PREVIEW_PREFIX)
}

function toSpaceRect(rect: NewSpaceRect): SpaceRect {
    return { col_start: rect.colStart, row_start: rect.rowStart, col_end: rect.colEnd, row_end: rect.rowEnd }
}

// Le test de relève porte sur le rectangle et jamais sur le nom : le nom d'une division est arbitré
// à la création (`resolveBoxName` et son échelle de repli), donc deux « Marketing » ne se
// recolleraient plus jamais, alors que la place, elle, vient du même `findRadialRect` des deux côtés.
function sameRect(a: SpaceRect, b: SpaceRect): boolean {
    const bounds = (rect: SpaceRect) => [Math.min(rect.col_start, rect.col_end), Math.max(rect.col_start, rect.col_end), Math.min(rect.row_start, rect.row_end), Math.max(rect.row_start, rect.row_end)]
    const left = bounds(a)
    const right = bounds(b)
    return left.every((value, index) => value === right[index])
}

const slugOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// L'identité d'une pièce de l'aperçu est son nom, jamais son rang : une division ajoutée en tête
// après un « Change something » décalerait sinon toutes les suivantes, qui se démonteraient (le
// package n'a pas d'animation de sortie) puis rejoueraient leur tracé avec leur délai de cascade.
// Deux divisions du même nom, dont le modèle est capable, se départagent au rang faute de mieux.
function uniqueKey(base: string, taken: Set<string>): string {
    let key = base
    for (let index = 2; taken.has(key); index++) key = `${base}-${index}`
    taken.add(key)
    return key
}

// Where agents land inside a Box: the row-major scan of `findFreeCellInSpace` on an empty Box, which
// steps by a footprint in both directions. Stops at the walls rather than looping, so a division the
// model overfilled draws the agents that fit and drops the rest, exactly as the server would leave
// them unplaced.
function anchorsIn(rect: NewSpaceRect, count: number): GridPosition[] {
    const anchors: GridPosition[] = []
    for (let row = rect.rowStart; row + AGENT_SPAN - 1 <= rect.rowEnd; row += AGENT_SPAN) {
        for (let col = rect.colStart; col + AGENT_SPAN - 1 <= rect.colEnd; col += AGENT_SPAN) {
            if (anchors.length === count) return anchors
            anchors.push({ col, row })
        }
    }
    return anchors
}

export function planScene(plan: ShownPlan, { animated = true, built = [], labels = BARE_NAMES }: PlanSceneOptions = {}): PlanScene {
    const containers: Container[] = []
    const tiles: Tile[] = []
    const placed: SpaceRect[] = []
    const boxKeys = new Set<string>()
    let landedAt = 0

    for (const group of plan.groups) {
        const rect = findRadialRect(placed)
        placed.push(toSpaceRect(rect))

        // A division with no name is not one the model declared: it is the flat list of a transcript
        // written before organisations existed, or the agents it filed nowhere. They still get a
        // floor, or the tiles float over bare grid.
        const boxKey = uniqueKey(slugOf(group.name ?? '') || 'box', boxKeys)
        const boxId = `${PLAN_PREVIEW_PREFIX}${boxKey}`
        if (built.some(existing => sameRect(existing, toSpaceRect(rect)))) continue

        // Le rang parmi les Box réellement dessinées : une division déjà construite ne laisse pas
        // un trou dans la cascade de celles qui restent.
        const boxDelay = containers.length * BOX_STEP
        containers.push({
            id: boxId,
            label: group.name,
            color: SPACE_COLOR,
            col_start: rect.colStart,
            row_start: rect.rowStart,
            col_end: rect.colEnd,
            row_end: rect.rowEnd,
            ariaLabel: group.name ? labels.planned(group.name) : labels.plannedBox,
            ...(animated ? { justPlaced: true, dropStyle: 'draw' as const, dropDuration: BOX_DRAW_MS, dropDelay: boxDelay } : {}),
        })
        landedAt = Math.max(landedAt, boxDelay + BOX_DRAW_MS)

        const agentKeys = new Set<string>()
        anchorsIn(rect, group.items.length).forEach((position, rank) => {
            const item = group.items[rank]
            const dropDelay = boxDelay + AGENT_LAG + rank * AGENT_STEP
            tiles.push({
                id: `${boxId}/${uniqueKey(slugOf(item.name) || 'agent', agentKeys)}`,
                position,
                span: AGENT_SPAN,
                containerId: boxId,
                style: agentTileStyle('idle', item.name),
                selectable: false,
                draggable: false,
                ariaLabel: labels.planned(item.name),
                ...(animated ? { justPlaced: true, dropDelay } : {}),
            })
            landedAt = Math.max(landedAt, dropDelay + TILE_DROP_MS)
        })
    }

    return { containers, tiles, landedAt: animated ? landedAt : 0 }
}

// The same scene, once it has landed, turned into a mock-up.
//
// Les deux couches racontent la même chose : l'empreinte des Box troque son trait plein pour le
// pointillé qui défile des fantômes du board, et les tuiles se hachurent en s'effaçant. Une
// opacité un peu plus basse ne suffisait pas — seule à seule sur un board vide, elle n'a rien à
// quoi se comparer et se lit comme un workspace déjà monté, un peu sombre.
//
// Tout est posé **après** l'entrée et jamais avant : `agent-drop-in` pousse l'opacité à 1 sans la
// tenir (pas de `forwards`), donc une tuile née translucide tomberait à pleine force puis sauterait
// une image plus tard. Déclaré tard, le changement passe par les transitions propres de la tuile et
// du contour, et le board bascule en maquette d'un seul mouvement.
export function settledPlanScene(scene: PlanScene): PlanScene {
    return {
        ...scene,
        containers: scene.containers.map(container => ({ ...container, ghost: true })),
        tiles: scene.tiles.map(tile => ({ ...tile, style: { ...tile.style, opacity: PREVIEW_TILE_OPACITY, sheen: false, stripes: true } })),
    }
}

// One division on its own, for its card in the plan rather than for the board: the Box is sized to
// the agents it holds instead of the board's 8x8, which would leave them unreadable in a card, and
// they stand in a row down its middle, clear of the four corners.
//
// Pieces are keyed by rank and not by name, unlike `planScene`: this one is drawn while the tool call
// is still streaming, and a name that grows a letter at a time would remount its tile on every one.
const CARD_BOX_MARGIN = 1
const CARD_AGENT_GAP = 1
const CARD_BOX_ID = 'plan-card:box'

export function planCardScene(group: PlanGroup, { animated = true, labels = BARE_NAMES }: Pick<PlanSceneOptions, 'animated' | 'labels'> = {}): Pick<PlanScene, 'containers' | 'tiles'> {
    const slots = Math.max(1, group.items.length)

    return {
        containers: [
            {
                id: CARD_BOX_ID,
                label: group.name,
                color: SPACE_COLOR,
                col_start: 0,
                row_start: 0,
                col_end: CARD_BOX_MARGIN * 2 + slots * AGENT_SPAN + (slots - 1) * CARD_AGENT_GAP - 1,
                row_end: CARD_BOX_MARGIN * 2 + AGENT_SPAN - 1,
                ghost: group.items.length === 0,
                ariaLabel: group.name ? labels.planned(group.name) : labels.plannedBox,
                ...(animated ? { justPlaced: true, dropStyle: 'draw' as const, dropDuration: BOX_DRAW_MS } : {}),
            },
        ],
        tiles: group.items.map((item, rank) => ({
            id: `${CARD_BOX_ID}/${rank}`,
            position: { col: CARD_BOX_MARGIN + rank * (AGENT_SPAN + CARD_AGENT_GAP), row: CARD_BOX_MARGIN },
            span: AGENT_SPAN,
            containerId: CARD_BOX_ID,
            style: agentTileStyle('idle', item.name),
            selectable: false,
            draggable: false,
            ariaLabel: labels.planned(item.name),
            ...(animated ? { justPlaced: true, dropDelay: AGENT_LAG + rank * AGENT_STEP } : {}),
        })),
    }
}
