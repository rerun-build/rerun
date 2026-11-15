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

const CORNER_CLASSES: Record<ForemanCorner, string> = {
    'top-left': 'top-[calc(var(--chrome-edge)+var(--chrome-size)+var(--chrome-gap)+var(--board-inset,0px))] left-[calc(var(--chrome-edge)+var(--board-inset,0px))]',
    'top-right': 'top-[calc(var(--chrome-edge)-var(--orb-overhang)+var(--board-inset,0px))] right-[calc(var(--chrome-edge)+var(--chrome-size)+var(--chrome-gap)+var(--board-inset,0px))]',
    'bottom-left':
        'bottom-[calc(var(--chrome-edge)-var(--orb-overhang)+var(--board-inset,0px)+var(--consent-inset))] left-[calc(var(--chrome-edge)+var(--board-corner-width,var(--chrome-size))+var(--chrome-gap)+var(--board-inset,0px))]',
    'bottom-right': 'bottom-[calc(var(--chrome-edge)-var(--orb-overhang)+var(--board-inset,0px)+var(--consent-inset))] right-[calc(var(--chrome-edge)+var(--board-inset,0px))]',
}

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

    const isMobile = useResolvedIsMobile(FOREMAN_COLUMN_QUERY)
    const tooNarrow = useResolvedIsMobile(PILL_TOO_NARROW_QUERY)
    const floatCorner = isMobile === false && placement?.mode === 'float' ? placement.corner : null
    const corner = floatCorner ?? orbCorner

    const [followedFloatCorner, setFollowedFloatCorner] = useState(floatCorner)
    if (floatCorner !== followedFloatCorner) {
        setFollowedFloatCorner(floatCorner)
        if (floatCorner) setOrbCorner(floatCorner)
    }
    useEffect(() => {
        if (floatCorner) rememberForemanOrbCorner(floatCorner)
    }, [floatCorner])

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
        const to = slot.getBoundingClientRect()
        x.set(from.left - to.left)
        y.set(from.top - to.top)
        const transition = { type: 'spring', stiffness: 500, damping: 38 } as const
        const controls = [animate(x, 0, transition), animate(y, 0, transition)]
        return () => controls.forEach(control => control.stop())
    }, [corner, x, y, reducedMotion])

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
    if (working && dismissedReplyId !== null) setDismissedReplyId(null)
    const shownNudge = pillVisible && nudge && nudge.id !== laterNudgeId ? nudge : null
    const shownReply = pillVisible && !nudge && reply && reply.id !== dismissedReplyId ? reply : null
    const bubbleShown = shownNudge !== null || shownReply !== null

    const gaze = useRef<OrbGaze | null>(null)
    useEffect(() => {
        gaze.current = bubbleShown ? { x: corner.endsWith('left') ? 0.5 : -0.5, y: corner.startsWith('bottom') ? -1 : 1 } : null
    }, [bubbleShown, corner])

    if (isMobile === null) return null

    const size = isMobile ? PARKED_ORB_SIZE_MOBILE : PARKED_ORB_SIZE
    const orbState = voice.status === 'listening' || bubbleShown ? 'listening' : foremanOrbState({ open, activity })

    const announcesShortcut = !isMobile && assistantReady && !!workspace && !isAnonymous && !open && !centerOpen && !dragging

    const handleDragEnd = (_event: PointerEvent | MouseEvent | TouchEvent, info: { point: { x: number; y: number } }) => {
        setDragging(false)
        const next = resolveCorner({ x: info.point.x - window.scrollX, y: info.point.y - window.scrollY }, { width: window.innerWidth, height: window.innerHeight })
        landingFromRef.current = orbRef.current?.getBoundingClientRect() ?? null
        rememberForemanOrbCorner(next)
        if (next === corner) {
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
        <div ref={slotRef} data-foreman-orb style={{ width: size, height: size, '--orb-overhang': `${(size - CHROME_SIZE) / 2}px` } as CSSProperties} className={cn('pointer-events-none fixed z-40', CORNER_CLASSES[corner])}>
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
