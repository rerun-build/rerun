'use client'

import { memo } from 'react'
import { HandIcon, LockIcon, TriangleAlertIcon } from '../../icons'
import { Badge } from '../../primitives/badge'
import { BLOCK_HEIGHT, DEFAULT_SPAN, DIAMOND, ISO_DIM_MS, ISO_DIM_OPACITY, ISO_HALO_COLOR, TILE_H, TILE_W, buddyFootprintShare, hashUnit, isoPosition, tileTopLift, tileZ } from '../iso'
import { TileHalo } from './TileHalo'
import { BUDDY_BADGE_GAP, TileBuddy } from './TileBuddy'
import { TileCountdownBadge } from './TileCountdownBadge'
import { buddyColor, buddyLook, buddyMood } from './buddy/buddy-look'
import type { Tile } from '../types'
import { useKitTranslations } from '../../locale'
import { tileStatusLabel } from '../status-label'

// Croisement du pictogramme et de la pastille de statut (cf. TileStatusBubble, même durée de
// sortie). Le pictogramme cède la place tout de suite, mais attend que la pastille soit partie pour
// revenir : sans ce délai on le verrait au travers d'elle pendant qu'elle s'efface.
const BADGE_FADE_MS = 140
const BADGE_RETURN_DELAY_MS = 100

// La bande de reflet, au clair d'une face. `shade` est la part de lumière que garde la face sur
// laquelle elle court : un `filter: brightness()` sur la face assombrissait la bande avec elle, et
// multiplier le blanc d'autant donne exactement la même image sans surface de rendu à part.
const shimmerGradient = (shade = 1) => {
    const white = Math.round(255 * shade)
    const sheen = (alpha: number) => `rgba(${white},${white},${white},${alpha})`
    return `linear-gradient(110deg, transparent 10%, ${sheen(0.08)} 20%, ${sheen(0.18)} 35%, ${sheen(0.25)} 50%, ${sheen(0.18)} 65%, ${sheen(0.08)} 80%, transparent 90%)`
}

// Les deux faces de côté sont la couleur du bloc, assombrie. Un `filter: brightness(k)` donnait le
// même pixel, au prix d'une surface de rendu par face : trente par page sur la landing, pour deux
// aplats qu'un mélange de couleurs calcule à l'identique — `color-mix` en sRGB multiplie bien
// chaque canal par `k` sur une couleur opaque, et celles des tiles le sont toutes.
const SIDE_SHADE = { left: 0.7, right: 0.5 }

const shaded = (color: string, shade: number) => `color-mix(in srgb, ${color} ${shade * 100}%, #000)`
// Lignes verticales écran (90°) = diagonale du losange (sommet à sommet) → lit comme diagonal sur la face iso
const STRIPE_GRADIENT = 'repeating-linear-gradient(90deg, transparent 0, transparent 2px, rgb(var(--iso-tile-ink) / 0.1) 2px, rgb(var(--iso-tile-ink) / 0.1) 3px)'

type TileBlockProps = {
    tile: Tile
    selected: boolean
    hovered?: boolean
    isDragging?: boolean
    dragPosition?: { col: number; row: number }
    worldOffset: { left: number; top: number }
    // Mode « ghost » de placement : bloc transparent en lévitation (combine selected + offline).
    // valid=false → rouge (hors container / collision), valid=true → gris.
    ghost?: { valid: boolean }
    // Sélection clavier (Enter/Espace) : la sélection souris reste gérée par le hit-test racine de
    // l'IsoGrid, on n'ajoute donc que le chemin clavier. Passer la référence *stable* du handler.
    onSelect?: (id: string) => void
    // Coupe les animations continues (shimmer/ping/pulse/badge) quand l'utilisateur a demandé
    // « réduire les animations » (prefers-reduced-motion).
    reducedMotion?: boolean
    // The board is frozen on its current frame (`data-iso-paused`): what a timer drives must hold too.
    paused?: boolean
    // La tile vient d'être posée → joue l'animation d'atterrissage à l'apparition (fade + slide down).
    justPlaced?: boolean
}

// Le dégradé fait 3 largeurs de face et se répète : la bande traverse la face 4 fois par cycle.
// La bande de 15 largeurs (5 copies) est peinte une fois puis déplacée par le compositeur.
function ShimmerStrip({ animation, shade }: { animation: string | undefined; shade?: number }) {
    return (
        <div
            className="absolute inset-y-0 left-0"
            style={{
                width: '1500%',
                backgroundImage: shimmerGradient(shade),
                backgroundSize: '20% 100%',
                animation,
                willChange: animation ? 'transform' : undefined,
            }}
        />
    )
}

export const TileBlock = memo(function TileBlock({ tile, selected, hovered, isDragging, dragPosition, worldOffset, ghost, onSelect, reducedMotion, paused, justPlaced }: TileBlockProps) {
    const t = useKitTranslations()
    const s = tile.style
    const span = tile.span ?? DEFAULT_SPAN
    const AW = span * TILE_W
    const AH = span * TILE_H
    const blockHeight = s.depth ?? BLOCK_HEIGHT
    const buddy = !!s.buddy
    // How far the top face stands above the tile's own box, which is as thick as a flat tile.
    const rise = tileTopLift(s, span) - blockHeight

    const renderPos = dragPosition ?? tile.position
    const pos = isoPosition(renderPos.col, renderPos.row)

    // Le ghost emprunte la lévitation/glow du « selected » et la transparence du style « offline ».
    const color = ghost ? (ghost.valid ? 'var(--iso-tile-muted)' : '#ef4444') : s.color
    // Les deux opacités se multiplient : `style.opacity` dit l'état de la tile (hors ligne), `dimmed`
    // dit qu'on regarde ailleurs. Une tile hors ligne mise en retrait doit rester la plus effacée
    // des deux, pas retrouver l'opacité de sa voisine.
    const blockOpacity = ghost ? 0.5 : (s.opacity ?? 1) * (tile.dimmed ? ISO_DIM_OPACITY : 1)
    const restingBuddy = buddy && buddyMood(s) === 'idle'
    const glow = ghost
        ? ghost.valid
            ? 'rgba(148,163,184,0.55)'
            : 'rgba(239,68,68,0.6)'
        : restingBuddy
          ? `color-mix(in srgb, ${buddyColor(tile.id, buddyLook(s))} 60%, transparent)`
          : s.glow ?? 'transparent'
    const glowing = selected || !!ghost
    // Un buddy sélectionné reste au sol et s'allonge (TileBuddy) : seuls les blocs plats se soulèvent.
    const lifted = (selected && !buddy) || !!ghost
    const showStripes = s.stripes === true || (s.stripes === 'hover' && (selected || !!hovered)) || !!ghost
    // Mise en avant, indépendante de la sélection : la tuile reste au sol et garde sa couleur, seul
    // un halo respire autour d'elle. Un ghost de placement n'est pas un objet du board.
    const highlighted = !!tile.highlighted && !ghost
    const haloColor = s.haloColor ?? (s.glow && s.glow !== 'transparent' ? s.glow : ISO_HALO_COLOR)

    const anim = (value: string) => (reducedMotion ? undefined : value)
    const interactive = !ghost && tile.selectable !== false
    // Atterrissage à l'apparition : uniquement pour une vraie tile fraîchement posée (jamais le
    // ghost ni pendant un drag), et coupé sous prefers-reduced-motion. Le keyframe pilote transform/
    // opacity/filter le temps de la chute puis rend la main aux styles de base (pas de fill-mode).
    const dropIn = !!justPlaced && !ghost && !isDragging && !reducedMotion
    // Un ghost de placement n'a pas d'état à raconter : il n'existe pas encore.
    const status = ghost ? null : s.status ?? null
    const pinnedStatus = status?.pinned ?? null
    // Les pings sont finis : ils rejouent quand le compte « to handle » change, via la key des
    // anneaux. Le churn du store re-render sans remonter le nœud, donc la valeur seule fait foi.
    const pingCycle = pinnedStatus?.count ?? 0
    const PinnedIcon = pinnedStatus?.icon === 'hand' ? HandIcon : pinnedStatus?.icon === 'warning' ? TriangleAlertIcon : null
    // Pendant du TileStatusBubble que l'IsoGrid pose au-dessus de la tile survolée.
    const statusBubbleShowing = !ghost && !!hovered && !!s.status
    const badgeTop = buddy ? (AH / 2) * (1 - buddyFootprintShare(s)) - rise - BUDDY_BADGE_GAP : -18

    return (
        <div
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? tile.ariaLabel : undefined}
            onKeyDown={
                interactive
                    ? e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onSelect?.(tile.id)
                          }
                      }
                    : undefined
            }
            data-ink={ghost ? undefined : s.ink}
            className={`iso-tile absolute focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70 ${ghost ? 'pointer-events-none' : isDragging ? 'pointer-events-auto cursor-grabbing' : 'pointer-events-auto cursor-pointer'}`}
            style={{
                // Centrage horizontal du losange : l'ancre (col,row) est le sommet nord du footprint.
                // AW/2 - TILE_W/2 = (span-1)*TILE_W/2. Pour span=2 ⇒ -TILE_W/2 (look agent inchangé) ;
                // pour span=1 ⇒ 0, sinon la tuile est décalée d'une demi-cellule et « flotte » hors sol.
                left: pos.left + worldOffset.left - (AW - TILE_W) / 2,
                top: pos.top + worldOffset.top - blockHeight,
                width: AW,
                height: AH + blockHeight,
                zIndex: isDragging ? 99998 : tileZ(renderPos.col, renderPos.row, span),
                opacity: blockOpacity,
                transform: isDragging ? 'translateY(-12px) scale(1.05)' : lifted ? 'translateY(-6px)' : undefined,
                transition: isDragging
                    ? 'transform 150ms ease-out, left 150ms cubic-bezier(0.2, 0, 0, 1), top 150ms cubic-bezier(0.2, 0, 0, 1)'
                    : `transform 200ms ease-out, left 150ms ease-out, top 150ms ease-out, opacity ${ISO_DIM_MS}ms ease`,
                filter: glowing ? `drop-shadow(0 0 8px ${glow}) drop-shadow(0 0 16px ${glow})` : undefined,
                // Tout dans le raccourci, délai et fill-mode compris : mélanger `animation` et ses
                // longhands fait râler React dès que la tile perd son `justPlaced` (le raccourci
                // disparaît, les longhands restent) — et surtout, le survivant s'appliquerait à
                // l'animation suivante.
                //
                // « backwards » n'est pas cosmétique : sans lui la tile est peinte au repos pendant
                // toute son attente, puis saute 100px plus haut pour retomber. Il tient le keyframe
                // 0% (invisible, en l'air) le temps du délai et ne survit pas à la fin de
                // l'animation, donc les transforms de base et de drag reprennent la main ensuite.
                animation: dropIn ? `agent-drop-in 1s linear ${tile.dropDelay ?? 0}ms backwards` : undefined,
            }}
        >
            {highlighted && <TileHalo side="back" width={AW} height={AH} depth={blockHeight + rise} offsetTop={-rise} color={haloColor} phase={hashUnit(tile.id, 11)} reducedMotion={reducedMotion} />}

            {/* Badge (ex. main pour « waiting_human »). Il s'efface au survol : la pastille de statut
                se pose à sa place et dit en toutes lettres ce que le pictogramme suggérait. Le fondu
                est porté par l'enveloppe, le clignotement restant sur l'élément intérieur — les deux
                jouent sur l'opacité et se disputeraient le même élément. */}
            {s.badge === 'hand' && (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center" style={{ top: badgeTop, opacity: statusBubbleShowing ? 0 : 1, transition: `opacity ${BADGE_FADE_MS}ms ease ${statusBubbleShowing ? 0 : BADGE_RETURN_DELAY_MS}ms` }}>
                    {/* 2.5 itérations : finit pile sur la keyframe 50% (opacité 1 = base), donc le
                        gel est invisible et aucun fill-mode n'est nécessaire. */}
                    <span className="flex" style={{ animation: anim('agent-waiting-dot 1.5s ease-in-out 2.5') }}>
                        <HandIcon className="size-3 text-cyan-400" />
                    </span>
                </div>
            )}

            {/* Badge « lock » : tile éteinte, aucune animation (rien n'est en cours). */}
            {s.badge === 'lock' && (
                <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center" style={{ top: badgeTop, opacity: statusBubbleShowing ? 0 : 1, transition: `opacity ${BADGE_FADE_MS}ms ease ${statusBubbleShowing ? 0 : BADGE_RETURN_DELAY_MS}ms` }}>
                    <LockIcon className="size-3 text-neutral-400" />
                </div>
            )}

            {(s.countdown || s.results) && !s.badge && !ghost && (
                <div className="absolute inset-x-0 flex justify-center" style={{ top: badgeTop, transform: 'translateY(-50%)', opacity: statusBubbleShowing ? 0 : 1, transition: `opacity ${BADGE_FADE_MS}ms ease ${statusBubbleShowing ? 0 : BADGE_RETURN_DELAY_MS}ms` }}>
                    <TileCountdownBadge countdown={s.countdown} results={s.results} />
                </div>
            )}

            {buddy ? (
                <TileBuddy id={tile.id} style={s} width={AW} height={AH} floorOffset={blockHeight} active={selected || !!hovered} stretched={selected && !ghost} ghost={ghost} reducedMotion={reducedMotion} paused={paused} />
            ) : (
                <>
                {/* Top face */}
                <div
                    className="absolute"
                    style={{
                        width: AW,
                        height: AH,
                        top: 0,
                        left: 0,
                        clipPath: DIAMOND,
                        backgroundColor: color,
                        overflow: 'hidden',
                    }}
                >
                    {s.shimmer && <ShimmerStrip animation={anim('agent-shimmer 4s ease-in-out infinite')} />}
                    {s.sheen && !ghost && <div className="absolute inset-0 pointer-events-none" style={{ background: 'var(--iso-tile-sheen)' }} />}
                    <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                            background: STRIPE_GRADIENT,
                            opacity: showStripes ? 1 : 0,
                            transition: 'opacity 200ms ease',
                        }}
                    />
                </div>

                {/* Left face */}
                <div
                    className="absolute"
                    style={{
                        width: AW / 2,
                        height: blockHeight,
                        top: AH / 2,
                        left: 0,
                        transform: 'skewY(26.565deg)',
                        transformOrigin: 'top left',
                        backgroundColor: shaded(color, SIDE_SHADE.left),
                        isolation: 'isolate',
                        overflow: 'hidden',
                    }}
                >
                    {s.shimmer && <ShimmerStrip animation={anim('agent-shimmer 4s ease-in-out infinite 0.5s')} shade={SIDE_SHADE.left} />}
                </div>

                {/* Right face */}
                <div
                    className="absolute"
                    style={{
                        width: AW / 2,
                        height: blockHeight,
                        top: AH / 2,
                        left: AW / 2,
                        transform: 'skewY(-26.565deg)',
                        transformOrigin: 'top right',
                        backgroundColor: shaded(color, SIDE_SHADE.right),
                        isolation: 'isolate',
                        overflow: 'hidden',
                    }}
                >
                    {s.shimmer && <ShimmerStrip animation={anim('agent-shimmer 4s ease-in-out infinite 1s')} shade={SIDE_SHADE.right} />}
                </div>

                {/* Edge wireframe */}
                <svg className="absolute pointer-events-none" style={{ top: 0, left: 0, width: AW, height: AH + blockHeight }} viewBox={`0 0 ${AW} ${AH + blockHeight}`} fill="none">
                    <polygon points={`${AW / 2},0 ${AW},${AH / 2} ${AW / 2},${AH} 0,${AH / 2}`} stroke="rgb(var(--iso-tile-ink) / 0.2)" strokeWidth="1" />
                    <line x1={0} y1={AH / 2} x2={0} y2={AH / 2 + blockHeight} stroke="rgb(var(--iso-tile-ink) / 0.15)" strokeWidth="1" />
                    <line x1={AW / 2} y1={AH} x2={AW / 2} y2={AH + blockHeight} stroke="rgb(var(--iso-tile-ink) / 0.15)" strokeWidth="1" />
                    <line x1={AW} y1={AH / 2} x2={AW} y2={AH / 2 + blockHeight} stroke="rgb(var(--iso-tile-ink) / 0.15)" strokeWidth="1" />
                    <line x1={0} y1={AH / 2 + blockHeight} x2={AW / 2} y2={AH + blockHeight} stroke="rgb(var(--iso-tile-ink) / 0.15)" strokeWidth="1" />
                    <line x1={AW / 2} y1={AH + blockHeight} x2={AW} y2={AH / 2 + blockHeight} stroke="rgb(var(--iso-tile-ink) / 0.15)" strokeWidth="1" />
                </svg>

                {/* Logo couché sur la face supérieure iso : rotateX(60deg) bascule
                    l'image dans le plan du dessus (raccourci vertical cos(60°)=0.5, soit le ratio 2:1),
                    rotateZ(-45deg) l'oriente le long des arêtes du losange (base orientée vers la droite).
                    Le logo « repose » sur la surface au lieu d'être debout en billboard. */}
                {s.image != null && (
                    <div className="absolute left-0 top-0 flex items-center justify-center pointer-events-none select-none" style={{ width: AW, height: AH }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={s.image}
                            alt=""
                            draggable={false}
                            style={{
                                width: AW * 0.38,
                                height: AW * 0.38,
                                objectFit: 'contain',
                                transform: 'rotateX(60deg) rotateZ(-45deg)',
                                filter: s.imageFilter,
                            }}
                        />
                    </div>
                )}

                {/* Label centré sur la face supérieure (rendu après les faces pour rester au-dessus),
                    doublé d'une ligne d'état pour les statuts qui doivent se lire sans survol. */}
                {(s.label != null || pinnedStatus) && (
                    <div className="absolute left-0 top-0 flex flex-col items-center justify-center pointer-events-none select-none" style={{ width: AW, height: AH }}>
                        {s.label != null && (
                            <span
                                className="text-[8px] font-normal tracking-tight whitespace-nowrap"
                                style={{ color: 'rgb(var(--iso-tile-ink) / 0.85)', filter: 'drop-shadow(0 1px 1.5px rgb(var(--iso-tile-ink-shadow) / 0.85))' }}
                            >
                                {s.label}
                            </span>
                        )}
                        {pinnedStatus && status && (
                            // Le fond `soft` du Badge n'est qu'une teinte à 12%, invisible sur une face
                            // déjà colorée ; `media` apporte l'encre blanche, mais son noir à 60% se
                            // pose comme un deuxième objet sur la tuile. On garde l'encre et on ramène
                            // le fond à un voile : ce qui dessine la pastille, c'est l'anneau du ton.
                            <Badge tone={status.tone} size="xs" fill="media" animated={false} className="mt-px gap-0.5 bg-black/20 px-1.5 py-px text-[7px]">
                                {pinnedStatus.spinner && (
                                    <span
                                        className="size-[5px] shrink-0 rounded-full border border-current border-t-transparent"
                                        style={{ animation: anim('iso-status-spin 0.8s linear infinite') }}
                                    />
                                )}
                                {PinnedIcon && <PinnedIcon className="size-[8px] shrink-0" />}
                                {pinnedStatus.count != null && <span className="tabular-nums">{pinnedStatus.count}</span>}
                                {tileStatusLabel(pinnedStatus, t)}
                            </Badge>
                        )}
                    </div>
                )}
                </>
            )}

            {/* Error pulse overlay */}
            {s.errorPulse && !buddy && (
                <div
                    className="absolute"
                    style={{
                        width: AW,
                        height: AH,
                        top: 0,
                        left: 0,
                        clipPath: DIAMOND,
                        backgroundColor: 'rgba(239, 68, 68, 0.3)',
                        // 4.5 itérations : finit sur la keyframe 50% (opacité 0.5), que `forwards`
                        // retient — sans lui, retour à l'opacité 1 de base, plus forte que toute
                        // frame animée.
                        animation: anim('agent-error-pulse 0.8s ease-in-out 4.5 forwards'),
                        pointerEvents: 'none',
                    }}
                />
            )}

            {/* Ping rings. `both` n'est pas cosmétique : la keyframe finit à opacité 0 mais la base
                est 1 — sans forwards l'anneau réapparaîtrait en contour permanent, et le backwards
                tient le 0% pendant le délai du second anneau. Ordre canonique « durée, délai » pour
                que le compte d'itérations parse sans ambiguïté. */}
            {s.pingRings && (
                <>
                    <div
                        key={`ping-a-${pingCycle}`}
                        className="absolute pointer-events-none"
                        style={{
                            width: AW + 8,
                            height: AH + 4,
                            top: -2 - rise,
                            left: -4,
                            clipPath: DIAMOND,
                            border: '1.5px solid rgba(6, 182, 212, 0.5)',
                            animation: anim('agent-ping 2s cubic-bezier(0, 0, 0.2, 1) 3 both'),
                        }}
                    />
                    <div
                        key={`ping-b-${pingCycle}`}
                        className="absolute pointer-events-none"
                        style={{
                            width: AW + 8,
                            height: AH + 4,
                            top: -2 - rise,
                            left: -4,
                            clipPath: DIAMOND,
                            border: '1.5px solid rgba(6, 182, 212, 0.5)',
                            animation: anim('agent-ping 2s cubic-bezier(0, 0, 0.2, 1) 0.6s 3 both'),
                        }}
                    />
                </>
            )}

            {/* Les deux planches de devant, peintes en dernier : elles se tiennent entre l'oeil et la
                tuile, donc les poser sous le bloc revient à ne pas les poser du tout. */}
            {highlighted && <TileHalo side="front" width={AW} height={AH} depth={blockHeight + rise} offsetTop={-rise} color={haloColor} phase={hashUnit(tile.id, 11)} reducedMotion={reducedMotion} />}
        </div>
    )
})
