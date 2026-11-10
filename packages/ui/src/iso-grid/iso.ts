export const GRID_SIZE = 12
export const TILE_W = 56
export const TILE_H = 28
export const DIAMOND = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'

// Thickness of a flat tile, and a buddy's height as a share of its footprint's width.
export const BLOCK_HEIGHT = 7
export const BUDDY_HEIGHT_RATIO = 15 / 80

// Couleur des quatre murs de lumière d'une tile mise en avant, quand son style n'en impose pas
// d'autre : la lumière neutre de la grille (violet de marque en clair, blanc en sombre).
export const ISO_HALO_COLOR = 'var(--iso-halo, #fff)'

// Mise en retrait : ce que la scène laisse derrière quand elle met une région en avant. Assez bas
// pour qu'il ne reste qu'une trace du plateau autour, assez haut pour que le retour se lise comme un
// rallumage et non comme une apparition. Une seule valeur pour les trois calques (tiles, containers,
// liens), sinon la scène s'éteint en trois temps.
export const ISO_DIM_OPACITY = 0.1
export const ISO_DIM_MS = 300

// Une tile occupe un bloc span×span de cellules. Sa position (col,row) est l'ancre = cellule
// nord (coin haut) du bloc. DEFAULT_SPAN reproduit l'ancien footprint d'agent (2×2).
export const DEFAULT_SPAN = 2
// Alias rétro-compatible : du code serveur/store consomme encore AGENT_SPAN via @rerun/iso-grid/iso.
export const AGENT_SPAN = DEFAULT_SPAN

// Sentinelle « non placé ». On ne peut pas se fier à col < 0 : un space peut vivre à des colonnes
// négatives, donc un agent légitimement placé y a un col négatif. -100000 est hors de portée de
// toute coordonnée atteignable par pan/zoom.
export const UNPLACED_COL = -100000
export function isPlaced(pos: { col: number }) {
    return pos.col > UNPLACED_COL
}

// How far a tile's top face stands above the floor. Everything anchored to the top of a tile
// (bubbles, halo, framing) reads it here, so a buddy and a flat tile are measured the same way.
export function tileTopLift(style: { depth?: number; buddy?: BuddyFootprint }, span = DEFAULT_SPAN) {
    return style.buddy ? span * TILE_W * BUDDY_HEIGHT_RATIO * buddyFootprintShare(style) : style.depth ?? BLOCK_HEIGHT
}

type BuddyFootprint = true | { footprintShare?: number }

// The share of its footprint's width a buddy fills: the rest is floor left showing around it, so
// two neighbours never touch. It shrinks as a whole, height included.
export const BUDDY_FOOTPRINT_SHARE = 0.8

export function buddyFootprintShare(style: { buddy?: BuddyFootprint }) {
    return (typeof style.buddy === 'object' ? style.buddy.footprintShare : undefined) ?? BUDDY_FOOTPRINT_SHARE
}

export function isoPosition(col: number, row: number) {
    return {
        left: (col - row) * (TILE_W / 2),
        top: (col + row) * (TILE_H / 2),
    }
}

// Base de tri des blocs : au-dessus du sol, du losange des containers (9000) et des liens.
export const TILE_Z_BASE = 10001

// z-index d'un bloc ancré en (col,row) : trié sur son coin avant (sud). Une ancre peut être
// fractionnaire (une affordance posée entre deux cellules) alors que z-index n'accepte qu'un entier :
// on tronque vers l'arrière, jamais vers l'avant. À profondeur égale c'est le bloc qui doit gagner,
// il a du volume au-dessus du sol ; arrondir au plus proche ferait repasser un décalque devant lui.
export function tileZ(col: number, row: number, span = 1, base = TILE_Z_BASE) {
    return Math.floor(col + row + 2 * (span - 1) + base)
}

// La cellule (c,r) est-elle couverte par une tile de footprint `span` ancrée en (col,row) ?
export function tileCoversCell(col: number, row: number, c: number, r: number, span = DEFAULT_SPAN) {
    return c >= col && c < col + span && r >= row && r < row + span
}

// Deux tiles (ancres a/b, footprints spanA/spanB) se chevauchent-elles ? Test AABB générique.
// Pour deux ancres 2×2, se réduit au comportement historique (|dc| < 2 && |dr| < 2).
export function tilesOverlap(a: { col: number; row: number }, b: { col: number; row: number }, spanA = DEFAULT_SPAN, spanB = DEFAULT_SPAN) {
    return a.col < b.col + spanB && b.col < a.col + spanA && a.row < b.row + spanB && b.row < a.row + spanA
}
export const agentsOverlap = (a: { col: number; row: number }, b: { col: number; row: number }) => tilesOverlap(a, b, DEFAULT_SPAN, DEFAULT_SPAN)

export function screenToGrid(screenX: number, screenY: number) {
    const col = Math.floor((screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2)
    const row = Math.floor((screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2)
    return { col, row }
}

// Aléatoire déterministe (FNV-1a) seedé sur une chaîne. Les grilles sont prérendues côté serveur,
// donc un Math.random() au render casserait l'hydratation : tout jitter visuel passe par ici.
export function hashUnit(input: string, salt: number) {
    let h = (0x811c9dc5 ^ salt) >>> 0
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return ((h >>> 0) % 10000) / 10000
}

// Les 4 faces (arêtes) du losange d'un container, nommées par les deux pointes qu'elles relient.
// Chacune regarde une direction de grille : 'top-right' → row décroissant, 'bottom-right' → col
// croissant, 'bottom-left' → row croissant, 'top-left' → col décroissant.
export type ContainerSide = 'top-right' | 'bottom-right' | 'bottom-left' | 'top-left'

export const CONTAINER_SIDES: readonly ContainerSide[] = ['top-right', 'bottom-right', 'bottom-left', 'top-left']

// Le rect d'un container, en cellules de grille. Les bornes ne sont pas forcément ordonnées :
// un container dessiné vers le haut a un col_end plus petit que son col_start.
export type ContainerCells = { col_start: number; row_start: number; col_end: number; row_end: number }

// Les quatre pointes du losange d'un container, celles qu'on attrape pour le redimensionner.
export type ContainerHandle = 'top' | 'right' | 'bottom' | 'left'

// Taille minimale d'un container sur chaque axe : le footprint d'une tile par défaut, plus une
// cellule de jeu de chaque côté. Ce plancher ne contraint pas le placement : une tile peut toucher
// n'importe quel bord du container.
export const MIN_CONTAINER_SPAN = DEFAULT_SPAN + 2

// Bornes ordonnées d'un rect. Tout ce qui suit raisonne dessus plutôt que sur col_start/col_end.
export function containerCellRange(rect: ContainerCells) {
    return {
        colMin: Math.min(rect.col_start, rect.col_end),
        colMax: Math.max(rect.col_start, rect.col_end),
        rowMin: Math.min(rect.row_start, rect.row_end),
        rowMax: Math.max(rect.row_start, rect.row_end),
    }
}

// Borne l'ancre pour que tout le footprint span×span tienne dans les bornes données.
export function clampAnchorToRange(range: ReturnType<typeof containerCellRange>, span: number, anchor: { col: number; row: number }) {
    return {
        col: Math.max(range.colMin, Math.min(range.colMax - (span - 1), anchor.col)),
        row: Math.max(range.rowMin, Math.min(range.rowMax - (span - 1), anchor.row)),
    }
}

// Le footprint span×span ancré en (anchor) tient-il entièrement dans le container ?
export function containerContainsTile(rect: ContainerCells, anchor: { col: number; row: number }, span: number) {
    const { colMin, colMax, rowMin, rowMax } = containerCellRange(rect)
    return anchor.col >= colMin && anchor.col + (span - 1) <= colMax && anchor.row >= rowMin && anchor.row + (span - 1) <= rowMax
}

// Nouveau rect d'un container dont on tire la poignée `handle` jusqu'à la cellule `cell`. Il
// enveloppe toujours ses tiles et ne descend jamais sous MIN_CONTAINER_SPAN. C'est le côté tiré
// qui recule quand le plancher est atteint, l'opposé ne bouge pas.
export function resizedContainerRect(rect: ContainerCells, handle: ContainerHandle, cell: { col: number; row: number }, tiles: readonly { col: number; row: number; span: number }[]): ContainerCells {
    const { colMin, colMax, rowMin, rowMax } = containerCellRange(rect)
    let colStart = colMin
    let colEnd = colMax
    let rowStart = rowMin
    let rowEnd = rowMax

    switch (handle) {
        case 'top':
            colStart = cell.col
            rowStart = cell.row
            break
        case 'right':
            colEnd = cell.col
            rowStart = cell.row
            break
        case 'bottom':
            colEnd = cell.col
            rowEnd = cell.row
            break
        case 'left':
            colStart = cell.col
            rowEnd = cell.row
            break
    }

    if (tiles.length > 0) {
        colStart = Math.min(colStart, ...tiles.map(t => t.col))
        colEnd = Math.max(colEnd, ...tiles.map(t => t.col + (t.span - 1)))
        rowStart = Math.min(rowStart, ...tiles.map(t => t.row))
        rowEnd = Math.max(rowEnd, ...tiles.map(t => t.row + (t.span - 1)))
    }

    let low = { col: Math.min(colStart, colEnd), row: Math.min(rowStart, rowEnd) }
    let high = { col: Math.max(colStart, colEnd), row: Math.max(rowStart, rowEnd) }

    if (high.col - low.col < MIN_CONTAINER_SPAN - 1) {
        if (handle === 'top' || handle === 'left') low = { ...low, col: high.col - (MIN_CONTAINER_SPAN - 1) }
        else high = { ...high, col: low.col + (MIN_CONTAINER_SPAN - 1) }
    }
    if (high.row - low.row < MIN_CONTAINER_SPAN - 1) {
        if (handle === 'top' || handle === 'right') low = { ...low, row: high.row - (MIN_CONTAINER_SPAN - 1) }
        else high = { ...high, row: low.row + (MIN_CONTAINER_SPAN - 1) }
    }

    return { col_start: low.col, col_end: high.col, row_start: low.row, row_end: high.row }
}

// Losange positionné d'un container : `bounds` est en coordonnées monde (worldOffset appliqué),
// `corners` et `path` sont locaux à cette boîte. Partagé par le rendu du container et par les
// affordances posées sur ses arêtes, pour que la géométrie ne soit calculée qu'à un seul endroit.
export function containerDiamond(rect: ContainerCells, worldOffset: { left: number; top: number }) {
    const colStart = Math.min(rect.col_start, rect.col_end)
    const colEnd = Math.max(rect.col_start, rect.col_end)
    const rowStart = Math.min(rect.row_start, rect.row_end)
    const rowEnd = Math.max(rect.row_start, rect.row_end)

    const topCorner = isoPosition(colStart, rowStart)
    const rightCorner = isoPosition(colEnd + 1, rowStart)
    const bottomCorner = isoPosition(colEnd + 1, rowEnd + 1)
    const leftCorner = isoPosition(colStart, rowEnd + 1)

    const points = [topCorner, rightCorner, bottomCorner, leftCorner]
    const allLefts = points.map(p => p.left + TILE_W / 2)
    const allTops = points.map(p => p.top)

    const minLeft = Math.min(...allLefts)
    const maxLeft = Math.max(...allLefts)
    const minTop = Math.min(...allTops)
    const maxTop = Math.max(...allTops)

    const local = (p: { left: number; top: number }) => ({ x: p.left + TILE_W / 2 - minLeft, y: p.top - minTop })
    const corners = { top: local(topCorner), right: local(rightCorner), bottom: local(bottomCorner), left: local(leftCorner) }

    return {
        bounds: { left: minLeft + worldOffset.left, top: minTop + worldOffset.top, width: maxLeft - minLeft, height: maxTop - minTop },
        corners,
        path: `M ${corners.top.x},${corners.top.y} L ${corners.right.x},${corners.right.y} L ${corners.bottom.x},${corners.bottom.y} L ${corners.left.x},${corners.left.y} Z`,
    }
}

// Milieu d'une face d'un container, en coordonnées de cellule. Une face va de start à end + 1, son
// milieu est donc (start + end + 1) / 2. Partagé par la marque « + » posée contre la face et par le
// calcul du rect de la Box voisine, pour que les deux se posent sur le même axe.
export function containerFaceCenter(rect: ContainerCells, side: ContainerSide) {
    const colStart = Math.min(rect.col_start, rect.col_end)
    const colEnd = Math.max(rect.col_start, rect.col_end)
    const rowStart = Math.min(rect.row_start, rect.row_end)
    const rowEnd = Math.max(rect.row_start, rect.row_end)

    const midCol = (colStart + colEnd + 1) / 2
    const midRow = (rowStart + rowEnd + 1) / 2

    switch (side) {
        case 'top-right':
            return { col: midCol, row: rowStart }
        case 'bottom-right':
            return { col: colEnd + 1, row: midRow }
        case 'bottom-left':
            return { col: midCol, row: rowEnd + 1 }
        case 'top-left':
            return { col: colStart, row: midRow }
    }
}
