'use client'

import type RFB from '@novnc/novnc/lib/rfb'
import { useTranslations } from 'next-intl'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'

import { DesktopScreenLoader } from '@/components/desktop/DesktopScreenLoader'
import { DEFAULT_SCREEN_ASPECT, panView, SCREEN_VIEW_AT_REST, screenPlacement, zoomView, type Point, type ScreenView, type Size } from '@/components/desktop/screen-zoom'
import { cn } from '@/lib/utils'

const GESTURE_EVENTS = ['gesturestart', 'gesturemove', 'gestureend'] as const

// What noVNC's GestureHandler puts on the events it dispatches on its canvas.
type GestureDetail = { type: string; clientX: number; clientY: number; magnitudeX?: number; magnitudeY?: number }

type HeldGesture = { type: 'pinch'; start: ScreenView; magnitude: number; focal: Point } | { type: 'drag'; start: ScreenView; from: Point }

const KEYSYM_CONTROL_LEFT = 0xffe3
const KEYSYM_V = 0x0076
const KEYSYM_RETURN = 0xff0d

// X11 keysyms: Latin-1 is its own code point, anything else is the code point offset into the
// Unicode range, and a line break is Return.
function keysymOf(char: string): number {
    if (char === '\n') return KEYSYM_RETURN
    const codePoint = char.codePointAt(0) ?? 0
    return codePoint <= 0xff ? codePoint : 0x01000000 + codePoint
}

export type DesktopViewerHandle = {
    // The remote clipboard is not this computer's: a paste has to be pushed there, then typed.
    paste: (text: string) => void
    // One key pressed and released, for a keyboard that cannot reach the canvas (a phone's).
    key: (keysym: number, code: string) => void
    // Text typed key by key: unlike a paste, it lands in a terminal as well as in a form.
    type: (text: string) => void
}

type DesktopViewerProps = {
    socketUrl: string
    onDisconnect: () => void
    // A screen to watch: nothing typed or clicked reaches the machine, and the pointer goes through
    // to whatever holds the viewer.
    viewOnly?: boolean
    ref?: Ref<DesktopViewerHandle>
    // The canvas the screen is painted on once connected, null when it goes: what a mirror copies.
    onCanvas?: (canvas: HTMLCanvasElement | null) => void
    className?: string
}

export function DesktopViewer({ socketUrl, onDisconnect, viewOnly = false, ref, onCanvas, className }: DesktopViewerProps) {
    const t = useTranslations('desktop.screen')
    const frameRef = useRef<HTMLDivElement>(null)
    const screenRef = useRef<HTMLDivElement>(null)
    const rfbRef = useRef<RFB | null>(null)
    const [connected, setConnected] = useState(false)
    const [view, setView] = useState<ScreenView>(SCREEN_VIEW_AT_REST)
    const [frameSize, setFrameSize] = useState<Size>({ width: 0, height: 0 })
    const [aspect, setAspect] = useState(DEFAULT_SCREEN_ASPECT)
    const viewRef = useRef(view)
    const aspectRef = useRef(aspect)
    const onDisconnectRef = useRef(onDisconnect)
    const onCanvasRef = useRef(onCanvas)
    useEffect(() => {
        onDisconnectRef.current = onDisconnect
        onCanvasRef.current = onCanvas
        viewRef.current = view
        aspectRef.current = aspect
    }, [onDisconnect, onCanvas, view, aspect])

    useEffect(() => {
        const frame = frameRef.current
        if (!frame || viewOnly) return
        const observer = new ResizeObserver(([entry]) => setFrameSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
        observer.observe(frame)
        return () => observer.disconnect()
    }, [viewOnly])

    // noVNC sends a pinch to the machine as Ctrl+wheel, which zooms the page in the coworker's browser
    // and keeps it zoomed for that site. Caught before it reaches the canvas, a pinch enlarges the view
    // here instead, and one finger moves an enlarged view. The screen's element is resized rather than
    // scaled, so noVNC rescales itself and a tap still lands on the pixel under the finger.
    useEffect(() => {
        const frame = frameRef.current
        if (!frame || viewOnly) return
        let held: HeldGesture | null = null
        const onGesture = (event: Event) => {
            const { type, clientX, clientY, magnitudeX = 0, magnitudeY = 0 } = (event as CustomEvent<GestureDetail>).detail
            const bounds = frame.getBoundingClientRect()
            const size = { width: bounds.width, height: bounds.height }
            const point = { x: clientX - bounds.left, y: clientY - bounds.top }
            if (event.type === 'gesturestart') {
                const current = viewRef.current
                if (type === 'pinch') held = { type, start: current, magnitude: Math.hypot(magnitudeX, magnitudeY), focal: point }
                else if (type === 'drag' && current.scale > 1) held = { type, start: current, from: point }
                else held = null
            }
            if (held?.type !== type) return
            event.stopPropagation()
            if (event.type === 'gestureend') held = null
            else if (held.type === 'drag') setView(panView(held.start, point.x - held.from.x, point.y - held.from.y, size, aspectRef.current))
            else if (held.magnitude > 0) setView(zoomView(held.start, (held.start.scale * Math.hypot(magnitudeX, magnitudeY)) / held.magnitude, held.focal, size, aspectRef.current))
        }
        for (const name of GESTURE_EVENTS) frame.addEventListener(name, onGesture, { capture: true })
        return () => {
            for (const name of GESTURE_EVENTS) frame.removeEventListener(name, onGesture, { capture: true })
        }
    }, [viewOnly])

    useEffect(() => {
        const screen = screenRef.current
        if (!screen) return
        let cancelled = false
        void import('@novnc/novnc/lib/rfb').then(({ default: Client }) => {
            if (cancelled) return
            const rfb = new Client(screen, socketUrl)
            rfb.scaleViewport = true
            rfb.viewOnly = viewOnly
            rfb.focusOnClick = !viewOnly
            rfb.background = 'transparent'
            rfb.addEventListener('connect', () => {
                setConnected(true)
                setView(SCREEN_VIEW_AT_REST)
                const canvas = screen.querySelector('canvas')
                if (canvas?.width && canvas.height) setAspect(canvas.width / canvas.height)
                onCanvasRef.current?.(canvas)
            })
            rfb.addEventListener('disconnect', () => {
                if (rfbRef.current !== rfb) return
                rfbRef.current = null
                setConnected(false)
                onCanvasRef.current?.(null)
                onDisconnectRef.current()
            })
            rfbRef.current = rfb
        })
        return () => {
            cancelled = true
            const rfb = rfbRef.current
            rfbRef.current = null
            rfb?.disconnect()
            setConnected(false)
            onCanvasRef.current?.(null)
        }
    }, [socketUrl, viewOnly])

    useImperativeHandle(ref, () => ({
        paste: text => {
            const rfb = rfbRef.current
            if (!rfb) return
            rfb.clipboardPasteFrom(text)
            rfb.sendKey(KEYSYM_CONTROL_LEFT, 'ControlLeft', true)
            rfb.sendKey(KEYSYM_V, 'KeyV')
            rfb.sendKey(KEYSYM_CONTROL_LEFT, 'ControlLeft', false)
            rfb.focus()
        },
        key: (keysym, code) => rfbRef.current?.sendKey(keysym, code),
        type: text => {
            const rfb = rfbRef.current
            if (!rfb) return
            for (const char of text) rfb.sendKey(keysymOf(char), null)
        },
    }))

    const placement = screenPlacement(view, frameSize, aspect)
    return (
        <div ref={frameRef} dir="ltr" className={cn('relative min-h-0 flex-1 overflow-hidden bg-muted/40', className)}>
            <DesktopScreenLoader fading={connected} compact={viewOnly} label={viewOnly ? undefined : t('connecting')} />
            <div
                ref={screenRef}
                style={{ width: `${placement.scale * 100}%`, height: `${placement.scale * 100}%`, transform: `translate(${placement.x}px, ${placement.y}px)` }}
                className={cn('absolute left-0 top-0 transition-opacity duration-300', connected ? 'opacity-100' : 'opacity-0', viewOnly && 'pointer-events-none')}
            />
        </div>
    )
}
