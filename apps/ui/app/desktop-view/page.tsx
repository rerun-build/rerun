'use client'

import { useEffect, useRef, useState } from 'react'

import { DesktopViewer, type DesktopViewerHandle } from '@/components/desktop/DesktopViewer'

type NativeBridge = { postMessage: (message: string) => void }

type DesktopViewBridge = DesktopViewerHandle & {
    mirror: (on: boolean, width?: number) => void
}

declare global {
    interface Window {
        ReactNativeWebView?: NativeBridge
        rerunDesktop?: DesktopViewBridge
    }
}

const MIRROR_FRAME_MS = 1000 / 8
const MIRROR_QUALITY = 0.7
const DEFAULT_MIRROR_WIDTH = 400

export default function DesktopView() {
    const viewer = useRef<DesktopViewerHandle>(null)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const [mirrorWidth, setMirrorWidth] = useState<number | null>(null)
    const [target, setTarget] = useState<{ socketUrl: string; viewOnly: boolean } | null>(null)

    useEffect(() => {
        const read = () => {
            const params = new URLSearchParams(window.location.hash.slice(1))
            const socketUrl = params.get('socket')
            setTarget(socketUrl ? { socketUrl, viewOnly: params.get('mode') === 'watch' } : null)
        }
        read()
        window.addEventListener('hashchange', read)
        return () => window.removeEventListener('hashchange', read)
    }, [])

    useEffect(() => {
        window.rerunDesktop = {
            paste: text => viewer.current?.paste(text),
            key: (keysym, code) => viewer.current?.key(keysym, code),
            type: text => viewer.current?.type(text),
            mirror: (on, width) => setMirrorWidth(on ? Math.round(width || DEFAULT_MIRROR_WIDTH) : null),
        }
        return () => {
            delete window.rerunDesktop
        }
    }, [])

    useEffect(() => {
        if (!mirrorWidth) return
        const copy = document.createElement('canvas')
        const context = copy.getContext('2d')
        if (!context) return
        const timer = setInterval(() => {
            const source = canvasRef.current
            if (!source?.width || !source.height) return
            copy.width = mirrorWidth
            copy.height = Math.round((mirrorWidth * source.height) / source.width)
            context.drawImage(source, 0, 0, copy.width, copy.height)
            window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'frame', uri: copy.toDataURL('image/jpeg', MIRROR_QUALITY) }))
        }, MIRROR_FRAME_MS)
        return () => clearInterval(timer)
    }, [mirrorWidth])

    const tell = (type: 'connected' | 'disconnected') => window.ReactNativeWebView?.postMessage(JSON.stringify({ type }))

    if (!target) return <div className="h-dvh bg-black" />
    return (
        <div className="flex h-dvh flex-col bg-black">
            <DesktopViewer
                ref={viewer}
                socketUrl={target.socketUrl}
                viewOnly={target.viewOnly}
                onDisconnect={() => tell('disconnected')}
                onCanvas={canvas => {
                    canvasRef.current = canvas
                    if (canvas) tell('connected')
                }}
                className="bg-black"
            />
        </div>
    )
}
