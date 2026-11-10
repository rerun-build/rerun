'use client'

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CHROME_SIZE } from '@rerun/ui/chrome'
import type { OrbGaze } from '@rerun/ui/foreman'
import { useResolvedIsMobile } from '@rerun/ui/primitives/use-is-mobile'

import { Orb } from '@/components/foreman/Orb'
import { PARKED_ORB_SIZE, PARKED_ORB_SIZE_MOBILE } from '@/components/foreman/constants'
import { ForemanDockPill, type ForemanDockPillMode } from '@/components/foreman/dock/ForemanDockPill'
import { ForemanNudge } from '@/components/foreman/dock/ForemanNudge'
import { ForemanReplyBubble } from '@/components/foreman/dock/ForemanReplyBubble'
import { useForemanVoice } from '@/components/foreman/dock/useForemanVoice'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { useModKeyLabel } from '@/hooks/useModKeyLabel'
import { foremanNudge } from '@/lib/foreman/dock-feed'
import { type ForemanCorner, loadForemanOrbCorner, rememberForemanOrbCorner, resolveCorner } from '@/lib/foreman-layout'
import { FOREMAN_COLUMN_QUERY } from '@/lib/foreman-open'
import { cn } from '@/lib/utils'
import { useControlCenterStore } from '@/stores/control-center.store'
import { foremanOrbState, selectForemanOpen, selectForemanVisible, useForemanStore } from '@/stores/foreman.store'
import { useSession } from '@/supabase/session/SessionProvider'

// `fixed` et pas `absolute` : l'orbe n'appartient à aucun cadre, elle est posée sur le viewport.
// C'est ce qui l'affranchit des `overflow-hidden` qui coupaient son halo. Le prix du `fixed`, c'est
// de rajouter soi-même ce dont la carte est rentrée du bord de l'écran (--board-inset, publié par
// BoardChatSplit) : sans lui l'orbe serait 9px plus près du coin que la barre du bas et le bouton
// Help, qui eux vivent dans la carte. Sous `md` cet inset vaut 0 et le calc retombe sur la ligne du
// reste du mobilier. Trois coins sont déjà tenus : en bas à gauche l'orbe s'assoit à droite de la
// rangée de BoardCornerActions (sa largeur publiée + un écart), en haut à gauche sous le sélecteur
// de workspace, en haut à droite à gauche de la pill de zoom du board. Plus haute que les pills,
// elle partage leur axe : posée dans une rangée, elle déborde d'autant au-dessus qu'en dessous
// (--orb-overhang), au lieu de s'aligner par le bord.
const CORNER_CLASSES: Record<ForemanCorner, string> = {
    'top-left': 'top-[calc(var(--chrome-edge)+var(--chrome-size)+var(--chrome-gap)+var(--board-inset,0px))] left-[calc(var(--chrome-edge)+var(--board-inset,0px))]',
    'top-right': 'top-[calc(var(--chrome-edge)-var(--orb-overhang)+var(--board-inset,0px))] right-[calc(var(--chrome-edge)+var(--chrome-size)+var(--chrome-gap)+var(--board-inset,0px))]',
    'bottom-left':
        'bottom-[calc(var(--chrome-edge)-var(--orb-overhang)+var(--board-inset,0px)+var(--consent-inset))] left-[calc(var(--chrome-edge)+var(--board-corner-width,var(--chrome-size))+var(--chrome-gap)+var(--board-inset,0px))]',
    'bottom-right': 'bottom-[calc(var(--chrome-edge)-var(--orb-overhang)+var(--board-inset,0px)+var(--consent-inset))] right-[calc(var(--chrome-edge)+var(--board-inset,0px))]',
}

// Under it the pill, grown to write in, would run into the bar at the bottom of the board: the
// Foreman stays the ball it was.
const PILL_TOO_NARROW_QUERY = '(max-width: 1023.98px)'

export function ForemanDock() {
    const open = useForemanStore(selectForemanOpen)
    const activity = useForemanStore(state => state.activity)
    const toggle = useForemanStore(state => state.toggle)
    const reducedMotion = useReducedMotion()
    const placement = useForemanStore(state => state.placement)
    const [orbCorner, setOrbCorner] = useState<ForemanCorner>(loadForemanOrbCorner)
    const x = useMotionValue(0)
    const y = useMotionValue(0)
    const slotRef = useRef<HTMLDivElement>(null)
    const orbRef = useRef<HTMLDivElement>(null)
    const draggedRef = useRef(false)
    const landingFromRef = useRef<DOMRect | null>(null)
    const [dragging, setDragging] = useState(false)
    const assistantReady = useForemanStore(state => selectForemanVisible(state) && state.funnel === 'companion')
    const centerOpen = useControlCenterStore(state => state.open)
    const { workspace, isAnonymous } = useSession()
    const mod = useModKeyLabel()
    const t = useTranslations('foreman.dock')

    // `size` pilote la boîte du svg et la taille des yeux, donc aucune classe responsive ne peut le
    // faire à notre place. La variante `resolved` rend `null` tant que la media query n'a pas été
    // lue côté client : sans elle, un téléphone afficherait l'orbe à 56px le temps d'une frame.
    const isMobile = useResolvedIsMobile(FOREMAN_COLUMN_QUERY)
    const tooNarrow = useResolvedIsMobile(PILL_TOO_NARROW_QUERY)
    // Fenêtre flottante et orbe ne font qu'un : fermée, la fenêtre se replie en orbe dans son coin.
    // Sous `md` la fenêtre ne flotte jamais, l'orbe y garde son coin à elle.
    const floatCorner = isMobile === false && placement?.mode === 'float' ? placement.corner : null
    const corner = floatCorner ?? orbCorner

    // Le coin propre de l'orbe suit la fenêtre, sinon redocker puis fermer la renverrait dans un
    // vieux coin.
    const [followedFloatCorner, setFollowedFloatCorner] = useState(floatCorner)
    if (floatCorner !== followedFloatCorner) {
        setFollowedFloatCorner(floatCorner)
        if (floatCorner) setOrbCorner(floatCorner)
    }
    useEffect(() => {
        if (floatCorner) rememberForemanOrbCorner(floatCorner)
    }, [floatCorner])

    // L'orbe lâchée saute dans son nouveau coin, puis on rejoue le chemin depuis là où le doigt
    // l'avait laissée : la translation de fin de drag devient le point de départ d'un retour à zéro.
    useLayoutEffect(() => {
        const from = landingFromRef.current
        const slot = slotRef.current
        if (!from || !slot) return
        landingFromRef.current = null
        if (reducedMotion) {
            x.set(0)
            y.set(0)
            return
        }
        // Mesuré sur le logement, que la translation ne déplace pas : une motion value ne s'écrit
        // dans le DOM qu'à la frame suivante, l'orbe elle-même serait encore à l'ancienne place.
        const to = slot.getBoundingClientRect()
        x.set(from.left - to.left)
        y.set(from.top - to.top)
        const transition = { type: 'spring', stiffness: 500, damping: 38 } as const
        const controls = [animate(x, 0, transition), animate(y, 0, transition)]
        return () => controls.forEach(control => control.stop())
    }, [corner, x, y, reducedMotion])

    // The pill is the Foreman's composer while its column is closed: what is typed or said in it
    // leaves from here, the run shows in it and the answer above it. The control center anchors to
    // the ball and a drag carries it away, so the pill steps aside for both without going away.
    const pillAvailable = isMobile === false && tooNarrow === false && assistantReady && !!workspace && !isAnonymous && !open
    const pillVisible = pillAvailable && !centerOpen && !dragging
    const setPillAvailable = useForemanStore(state => state.setPillAvailable)
    useEffect(() => {
        setPillAvailable(pillAvailable)
        return () => setPillAvailable(false)
    }, [pillAvailable, setPillAvailable])

    const dock = useForemanStore(state => state.dock)
    const sending = useForemanStore(state => state.pendingPrompt !== null)
    const working = dock.busy || sending
    const voice = useForemanVoice(pillVisible && !working)
    const pillMode: ForemanDockPillMode = voice.status !== 'idle' ? { kind: 'voice', phase: voice.status, stream: voice.stream } : working ? { kind: 'ticker', label: dock.label } : { kind: 'field' }

    // ⌘K. A request made while the column is open is the column's; one made while the control
    // center covers the pill waits for it to come back.
    const inputRef = useRef<HTMLInputElement>(null)
    const focusRequest = useForemanStore(state => state.composerFocusRequest)
    const handledFocusRequest = useRef(focusRequest)
    useEffect(() => {
        if (handledFocusRequest.current === focusRequest) return
        if (open) handledFocusRequest.current = focusRequest
        if (!pillVisible) return
        handledFocusRequest.current = focusRequest
        inputRef.current?.focus()
    }, [focusRequest, open, pillVisible])

    const nudge = useMemo(() => (dock.pending ? foremanNudge(dock.pending) : null), [dock.pending])
    const [laterNudgeId, setLaterNudgeId] = useState<string | null>(null)
    const reply = dock.failed ? { id: 'failed', text: t('failedReply') } : dock.reply
    const [dismissedReplyId, setDismissedReplyId] = useState<string | null>(null)
    // The next turn's failure is a new one, even though every failure reads the same.
    if (working && dismissedReplyId !== null) setDismissedReplyId(null)
    const shownNudge = pillVisible && nudge && nudge.id !== laterNudgeId ? nudge : null
    const shownReply = pillVisible && !nudge && reply && reply.id !== dismissedReplyId ? reply : null
    const bubbleShown = shownNudge !== null || shownReply !== null

    // The ball looks at the card it holds up, towards the screen and away from its own edge.
    const gaze = useRef<OrbGaze | null>(null)
    useEffect(() => {
        gaze.current = bubbleShown ? { x: corner.endsWith('left') ? 0.5 : -0.5, y: corner.startsWith('bottom') ? -1 : 1 } : null
    }, [bubbleShown, corner])

    if (isMobile === null) return null

    const size = isMobile ? PARKED_ORB_SIZE_MOBILE : PARKED_ORB_SIZE
    const orbState = voice.status === 'listening' || bubbleShown ? 'listening' : foremanOrbState({ open, activity })

    // What the control center itself asks for before it anchors to the orb, minus the phone, which
    // has no ⌘F to announce.
    const announcesShortcut = !isMobile && assistantReady && !!workspace && !isAnonymous && !open && !centerOpen && !dragging

    const handleDragEnd = (_event: PointerEvent | MouseEvent | TouchEvent, info: { point: { x: number; y: number } }) => {
        setDragging(false)
        const next = resolveCorner({ x: info.point.x - window.scrollX, y: info.point.y - window.scrollY }, { width: window.innerWidth, height: window.innerHeight })
        landingFromRef.current = orbRef.current?.getBoundingClientRect() ?? null
        rememberForemanOrbCorner(next)
        if (next === corner) {
            // Même coin : aucun rendu ne viendra relancer l'effet, le retour se joue ici.
            landingFromRef.current = null
            const transition = reducedMotion ? { duration: 0 } : ({ type: 'spring', stiffness: 500, damping: 38 } as const)
            animate(x, 0, transition)
            animate(y, 0, transition)
            return
        }
        setOrbCorner(next)
        if (floatCorner && placement?.mode === 'float') useForemanStore.getState().setPlacement({ ...placement, corner: next })
    }

    return (
        // z-40, le niveau du mobilier du board (barre du bas, Help, switchers) : l'orbe en fait
        // partie, donc les panneaux latéraux (z-50) se posent dessus au lieu de passer dessous.
        <div ref={slotRef} data-foreman-orb style={{ width: size, height: size, '--orb-overhang': `${(size - CHROME_SIZE) / 2}px` } as CSSProperties} className={cn('pointer-events-none fixed z-40', CORNER_CLASSES[corner])}>
            {/* Le coin est sous le panneau une fois celui-ci ouvert : la bête n'y reste pas, elle
                repasse en tête de la colonne (ForemanHeader). Un fondu, pas un vol — deux instances
                d'un svg coûtent moins cher que le suivi d'une cible qui bouge avec le composer.
                Fermée, on peut la traîner : lâchée, elle s'aimante au coin le plus proche. */}
            <ForemanDockPill
                side={corner.endsWith('left') ? 'left' : 'right'}
                mode={pillMode}
                tone={nudge ? 'orange' : dock.failed ? 'red' : undefined}
                hidden={!pillVisible}
                mod={mod}
                inputRef={inputRef}
                onSubmit={text => useForemanStore.getState().sendToForeman(text)}
                onEngage={() => useForemanStore.getState().engage()}
            />
            <motion.div
                ref={orbRef}
                className={cn('relative block', !open && 'pointer-events-auto touch-none')}
                style={{ x, y }}
                drag={!open}
                dragMomentum={false}
                onPointerDownCapture={() => {
                    draggedRef.current = false
                }}
                onDragStart={() => {
                    draggedRef.current = true
                    setDragging(true)
                }}
                onDragEnd={handleDragEnd}
                animate={{ opacity: open ? 0 : 1, scale: open ? 0.7 : 1 }}
                transition={reducedMotion ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }}
            >
                <TooltipLabeled
                    side={corner.startsWith('bottom') ? 'top' : 'bottom'}
                    hidden={!announcesShortcut}
                    label={t.rich('tooltip', { shortcut: `${mod}F`, key: chunks => <span className="opacity-60">{chunks}</span> })}
                >
                    <span className="block">
                        <Orb
                            size={size}
                            state={orbState}
                            gaze={gaze}
                            paused={open}
                            facing={corner.endsWith('left') ? 'right' : 'left'}
                            onClick={
                                open
                                    ? undefined
                                    : () => {
                                          // Le clic qui suit un drag n'est que la fin du geste.
                                          if (draggedRef.current) {
                                              draggedRef.current = false
                                              return
                                          }
                                          toggle()
                                      }
                            }
                        />
                    </span>
                </TooltipLabeled>
                {/* A question put off with « Later » is still waiting: the ball keeps its mark. */}
                {nudge && !shownNudge && !open && (
                    <span aria-hidden className={cn('pointer-events-none absolute -top-1 flex size-5 items-center justify-center rounded-full bg-amber-500 text-[11px] leading-none font-bold text-black ring-2 ring-background', corner.endsWith('left') ? '-right-1' : '-left-1')}>
                        ?
                    </span>
                )}
            </motion.div>
            <AnimatePresence>
                {shownNudge ? (
                    <ForemanNudge key={shownNudge.id} corner={corner} nudge={shownNudge} onOpen={toggle} onLater={() => setLaterNudgeId(shownNudge.id)} />
                ) : shownReply ? (
                    <ForemanReplyBubble key={shownReply.id} corner={corner} text={shownReply.text} failed={dock.failed} onOpen={toggle} onDismiss={() => setDismissedReplyId(shownReply.id)} />
                ) : null}
            </AnimatePresence>
        </div>
    )
}
