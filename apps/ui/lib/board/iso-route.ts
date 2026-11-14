import { DEFAULT_SPAN, routeTileLinks, type AxisPoint, type LinkFootprint, type RoutedLink, type RoutedTile } from '@rerun/ui/iso-grid'

// Les prédicats qui permettent de savoir ce qu'un tracé rencontre, sur les tracés mêmes que
// `TileLinks` dessine : ils viennent tous de `routeTileLinks`, qui place les liens d'un board
// ensemble. Un câble ne se trace donc vraiment qu'avec ses voisins ; `routeAlone` en donne
// l'estimation d'avant, pour choisir où poser une tuile.

export type { AxisPoint }

// Durée du branchement d'un câble qui porte un appearDelay.
export const CABLE_DRAW_MS = 420

// Le paramètre est typé sur sa forme et non sur Tile : une cellule candidate, qui n'est pas encore
// une tuile, doit pouvoir être routée.
export type AxisTile = { position: { col: number; row: number }; span?: number }

// Les tracés d'un board, tels que dessinés, par lien source->target.
export function routeBoard(tiles: RoutedTile[], links: RoutedLink[]) {
    return routeTileLinks(tiles, links)
}

// Le tracé qu'aurait un lien posé seul entre deux tuiles, les autres tuiles en obstacles : ce que
// le placement peut savoir d'un câble avant que le board soit fini. Ses extrémités peuvent encore
// glisser d'un demi-pas le long de leur face quand d'autres liens les rejoignent.
export function routeAlone(source: RoutedTile, target: RoutedTile, obstacles: LinkFootprint[]): AxisPoint[] {
    return routeTileLinks([source, target], [{ source: source.id, target: target.id, variant: 'cable' }], obstacles).get(`${source.id}->${target.id}`) ?? []
}

// ---------------------------------------------------------------------------
// Ce qu'un tracé rencontre
// ---------------------------------------------------------------------------
// Toute la géométrie se fait en (u,v) et jamais en pixels : le passage à l'écran est affine, donc il
// préserve les intersections, mais il introduirait du bruit flottant. Les tracés sont alignés sur
// les axes et deux points d'un même couloir portent la même valeur calculée une seule fois, donc les
// tests d'orientation restent des égalités vraies.

const cross = (a: AxisPoint, b: AxisPoint, c: AxisPoint) => (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u)

const samePoint = (a: AxisPoint, b: AxisPoint) => a.u === b.u && a.v === b.v

// Combiné à cross(a,b,p) === 0, c'est « p appartient au segment [a,b] », extrémités comprises.
const withinBounds = (a: AxisPoint, b: AxisPoint, p: AxisPoint) =>
    Math.min(a.u, b.u) <= p.u && p.u <= Math.max(a.u, b.u) && Math.min(a.v, b.v) <= p.v && p.v <= Math.max(a.v, b.v)

// 'proper' : les deux segments se traversent en un point intérieur aux deux. 'contact' : ils se
// touchent ou se recouvrent, et les points de contact sont alors forcément des extrémités
// d'entrée, donc exacts. Le point d'un croisement propre n'est jamais calculé : il demanderait une
// division, et aucun appelant n'en a besoin.
export type SegmentHit = { kind: 'none' } | { kind: 'proper' } | { kind: 'contact'; points: AxisPoint[] }

export function segmentHit(a0: AxisPoint, a1: AxisPoint, b0: AxisPoint, b1: AxisPoint): SegmentHit {
    const d0 = cross(b0, b1, a0)
    const d1 = cross(b0, b1, a1)
    const d2 = cross(a0, a1, b0)
    const d3 = cross(a0, a1, b1)

    if (((d0 > 0 && d1 < 0) || (d0 < 0 && d1 > 0)) && ((d2 > 0 && d3 < 0) || (d2 < 0 && d3 > 0))) return { kind: 'proper' }

    const points: AxisPoint[] = []
    if (d0 === 0 && withinBounds(b0, b1, a0)) points.push(a0)
    if (d1 === 0 && withinBounds(b0, b1, a1)) points.push(a1)
    if (d2 === 0 && withinBounds(a0, a1, b0)) points.push(b0)
    if (d3 === 0 && withinBounds(a0, a1, b1)) points.push(b1)

    return points.length > 0 ? { kind: 'contact', points } : { kind: 'none' }
}

// Une route et l'identité de la tuile dont elle part, pour reconnaître un faisceau.
export type AxisRoute = { points: AxisPoint[]; sourceId: string }

// Le tronc : la portion de départ que deux routes issues de la même tuile parcourent ensemble.
// routeTileLinks écarte les extrémités d'une même face, mais une estimation `routeAlone` part du
// milieu de la face, donc deux câbles estimés qui sortent du même côté partagent leur ancre et se
// superposent jusqu'à ce que le second bifurque. C'est une fourche, pas un croisement, et
// l'interdire rendrait le placement infaisable dès qu'un agent a deux outils du même côté.
type Trunk = { origin: AxisPoint; du: number; dv: number; length: number }

function trunkOf(a: AxisRoute, b: AxisRoute): Trunk | null {
    if (a.sourceId !== b.sourceId) return null
    if (a.points.length < 2 || b.points.length < 2) return null
    if (!samePoint(a.points[0], b.points[0])) return null

    const origin = a.points[0]
    const pa = { u: a.points[1].u - origin.u, v: a.points[1].v - origin.v }
    const pb = { u: b.points[1].u - origin.u, v: b.points[1].v - origin.v }
    // Les segments de route sont alignés sur un axe : la longueur Manhattan est la longueur, et la
    // direction unitaire a ses composantes dans {0, ±1}, donc elle reste exacte.
    const la = Math.abs(pa.u) + Math.abs(pa.v)
    const lb = Math.abs(pb.u) + Math.abs(pb.v)
    if (la === 0 || lb === 0) return null

    // Deux sorties par des faces différentes : pas de tronc, seule l'ancre commune est tolérée.
    const sameDirection = pa.u * pb.v - pa.v * pb.u === 0 && pa.u * pb.u + pa.v * pb.v > 0
    return { origin, du: pa.u / la, dv: pa.v / la, length: sameDirection ? Math.min(la, lb) : 0 }
}

function onTrunk(point: AxisPoint, trunk: Trunk) {
    const du = point.u - trunk.origin.u
    const dv = point.v - trunk.origin.v
    const along = du * trunk.du + dv * trunk.dv
    return du * trunk.dv - dv * trunk.du === 0 && along >= 0 && along <= trunk.length
}

export function routesCross(a: AxisRoute, b: AxisRoute): boolean {
    const trunk = trunkOf(a, b)

    for (let i = 0; i + 1 < a.points.length; i++) {
        for (let j = 0; j + 1 < b.points.length; j++) {
            const hit = segmentHit(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1])
            if (hit.kind === 'none') continue
            // Un croisement transversal ne peut pas tomber sur le tronc : deux segments y sont
            // colinéaires, donc jamais transversaux.
            if (hit.kind === 'proper') return true
            if (trunk && hit.points.every(point => onTrunk(point, trunk))) continue
            return true
        }
    }

    return false
}

// L'empreinte d'une tuile en (u,v) : un carré aligné sur les axes, qui se projette exactement sur
// son losange à l'écran.
export type AxisBox = { u0: number; v0: number; u1: number; v1: number }

export function tileAxisBox(tile: AxisTile): AxisBox {
    const span = tile.span ?? DEFAULT_SPAN
    return { u0: tile.position.col, v0: tile.position.row, u1: tile.position.col + span, v1: tile.position.row + span }
}

// Liang-Barsky : le clip paramétrique gère les segments parallèles à une bande sans division par
// zéro, ce qui est le cas courant ici puisque toute route est alignée sur un axe. `margin` dilate
// le carré ; à 0 même raser une arête compte, puisqu'un câble posé sur l'arête d'un losange
// disparaît sous la silhouette du bloc, qui est peinte au-dessus des liens.
export function segmentHitsBox(a: AxisPoint, b: AxisPoint, box: AxisBox, margin = 0): boolean {
    const u0 = box.u0 - margin
    const u1 = box.u1 + margin
    const v0 = box.v0 - margin
    const v1 = box.v1 + margin
    const du = b.u - a.u
    const dv = b.v - a.v
    let t0 = 0
    let t1 = 1

    const clip = (p: number, q: number) => {
        if (p === 0) return q >= 0
        const r = q / p
        if (p < 0) {
            if (r > t1) return false
            if (r > t0) t0 = r
        } else {
            if (r < t0) return false
            if (r < t1) t1 = r
        }
        return true
    }

    return clip(-du, a.u - u0) && clip(du, u1 - a.u) && clip(-dv, a.v - v0) && clip(dv, v1 - a.v) && t0 <= t1
}

export function routeHitsBox(points: AxisPoint[], box: AxisBox, margin = 0): boolean {
    for (let i = 0; i + 1 < points.length; i++) {
        if (segmentHitsBox(points[i], points[i + 1], box, margin)) return true
    }
    return false
}
