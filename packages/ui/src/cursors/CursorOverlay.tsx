'use client'

import { AnimatePresence, motion, useSpring } from 'motion/react'
import { useEffect } from 'react'
import { CursorMark } from './CursorMark'

export type Cursor = {
    id: string
    name: string
    color: string
    x: number
    y: number
    avatarUrl?: string | null
}

const SPRING = { stiffness: 500, damping: 50 }

export function CursorOverlay({ cursors, zoom, showAvatars = false }: { cursors: Cursor[]; zoom: number; showAvatars?: boolean }) {
    return (
        <AnimatePresence>
            {cursors.map(cursor => (
                <RemoteCursor key={cursor.id} cursor={cursor} zoom={zoom} showAvatars={showAvatars} />
            ))}
        </AnimatePresence>
    )
}

function RemoteCursor({ cursor, zoom, showAvatars }: { cursor: Cursor; zoom: number; showAvatars: boolean }) {
    const x = useSpring(cursor.x, SPRING)
    const y = useSpring(cursor.y, SPRING)

    useEffect(() => {
        x.set(cursor.x)
        y.set(cursor.y)
    }, [cursor.x, cursor.y, x, y])

    return (
        <motion.div
            style={{ position: 'absolute', left: x, top: y, transformOrigin: '0 0', pointerEvents: 'none', zIndex: 1000000 }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1 / zoom, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
        >
            <CursorMark name={cursor.name} color={cursor.color} photoUrl={showAvatars ? cursor.avatarUrl : undefined} />
        </motion.div>
    )
}
