'use client'

import { useEffect, useRef } from 'react'

const FRAME_MS = 1000 / 15

export function ScreenMirror({ source }: { source: HTMLCanvasElement }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context) return
        let frame = 0
        let last = 0
        const paint = (now: number) => {
            frame = requestAnimationFrame(paint)
            if (now - last < FRAME_MS) return
            last = now
            const width = Math.round(canvas.clientWidth * devicePixelRatio)
            const height = Math.round(canvas.clientHeight * devicePixelRatio)
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width
                canvas.height = height
            }
            if (source.width && source.height) context.drawImage(source, 0, 0, width, height)
        }
        frame = requestAnimationFrame(paint)
        return () => cancelAnimationFrame(frame)
    }, [source])

    return <canvas ref={canvasRef} className="pointer-events-none size-full" />
}
