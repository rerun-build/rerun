'use client'

import type RFB from '@novnc/novnc'
import { useTranslations } from 'next-intl'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'

import { DesktopScreenLoader } from '@/components/desktop/DesktopScreenLoader'
import { cn } from '@/lib/utils'

const KEYSYM_CONTROL_LEFT = 0xffe3
const KEYSYM_V = 0x0076
const KEYSYM_RETURN = 0xff0d

function keysymOf(char: string): number {
    if (char === '\n') return KEYSYM_RETURN
    const codePoint = char.codePointAt(0) ?? 0
    return codePoint <= 0xff ? codePoint : 0x01000000 + codePoint
}

export type DesktopViewerHandle = {
    paste: (text: string) => void
    key: (keysym: number, code: string) => void
    type: (text: string) => void
}

type DesktopViewerProps = {
    socketUrl: string
    onDisconnect: () => void
    viewOnly?: boolean
    ref?: Ref<DesktopViewerHandle>
    onCanvas?: (canvas: HTMLCanvasElement | null) => void
    className?: string
}

export function DesktopViewer({ socketUrl, onDisconnect, viewOnly = false, ref, onCanvas, className }: DesktopViewerProps) {
    const t = useTranslations('desktop.screen')
    const screenRef = useRef<HTMLDivElement>(null)
    const rfbRef = useRef<RFB | null>(null)
    const [connected, setConnected] = useState(false)
    const onDisconnectRef = useRef(onDisconnect)
    const onCanvasRef = useRef(onCanvas)
    useEffect(() => {
        onDisconnectRef.current = onDisconnect
        onCanvasRef.current = onCanvas
    }, [onDisconnect, onCanvas])

    useEffect(() => {
        const screen = screenRef.current
        if (!screen) return
        let cancelled = false
        void import('@novnc/novnc').then(({ default: Client }) => {
            if (cancelled) return
            const rfb = new Client(screen, socketUrl)
            rfb.scaleViewport = true
            rfb.viewOnly = viewOnly
            rfb.focusOnClick = !viewOnly
            rfb.background = 'transparent'
            rfb.addEventListener('connect', () => {
                setConnected(true)
                onCanvasRef.current?.(screen.querySelector('canvas'))
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

    return (
        <div className={cn('relative min-h-0 flex-1 bg-muted/40', className)}>
            <DesktopScreenLoader fading={connected} compact={viewOnly} label={viewOnly ? undefined : t('connecting')} />
            <div ref={screenRef} className={cn('absolute inset-0 transition-opacity duration-300', connected ? 'opacity-100' : 'opacity-0', viewOnly && 'pointer-events-none')} />
        </div>
    )
}
