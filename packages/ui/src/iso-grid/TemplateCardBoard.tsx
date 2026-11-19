'use client'

import type { TemplateConnector } from '@moldwright/contracts'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { CARD_HEIGHT, CARD_MAX_ZOOM, CARD_WIDTH } from './card-capture'
import { type BoardAgent, TemplateBoardPreview } from './TemplateBoardPreview'

export function TemplateCardBoard({ agents, connectors, maxZoom = CARD_MAX_ZOOM }: { agents: BoardAgent[]; connectors: TemplateConnector[]; maxZoom?: number }) {
    const { ref, scale } = useCaptureScale()

    return (
        <motion.div
            aria-hidden
            ref={ref}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-0 overflow-hidden bg-[#fafafa] dark:bg-[#0a0a0a]"
        >
            {scale !== null && (
                <div
                    className="absolute left-1/2 top-1/2"
                    style={{ width: CARD_WIDTH, height: CARD_HEIGHT, transform: `translate(-50%, -50%) scale(${scale})` }}
                >
                    <TemplateBoardPreview alive agents={agents} connectors={connectors} maxZoom={maxZoom} className="size-full" />
                </div>
            )}
        </motion.div>
    )
}

function useCaptureScale() {
    const ref = useRef<HTMLDivElement>(null)
    const [scale, setScale] = useState<number | null>(null)

    useEffect(() => {
        const element = ref.current
        if (!element) return
        const measure = () => {
            if (element.clientWidth > 0 && element.clientHeight > 0) {
                setScale(Math.min(element.clientWidth / CARD_WIDTH, element.clientHeight / CARD_HEIGHT))
            }
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [])

    return { ref, scale }
}
