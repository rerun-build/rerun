'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import { AppLoader } from '@/components/layout/AppLoader'
import { useAppBootStore } from '@/stores/app-boot.store'

// Past it, a part still loading (a slow engine reading the conversation) shows its own skeleton
// rather than keeping the whole app behind the logo.
const BOOT_HOLD_MAX_MS = 2500

// One loader over the whole frame until the app can show itself in one go, instead of a logo in the
// board's track beside a column already painting its skeletons. Lifted once per page load: a
// workspace switch is a hard navigation, covered by WorkspaceSwitchLoader until the new page paints this.
export function AppBootCover() {
    const boardReady = useAppBootStore(state => state.boardReady)
    const held = useAppBootStore(state => state.holds > 0)
    const reduceMotion = useReducedMotion()
    const [holdExpired, setHoldExpired] = useState(false)
    const [revealed, setRevealed] = useState(false)

    useEffect(() => {
        if (!boardReady) return
        const timer = setTimeout(() => setHoldExpired(true), BOOT_HOLD_MAX_MS)
        return () => clearTimeout(timer)
    }, [boardReady])

    const ready = boardReady && (!held || holdExpired)
    if (ready && !revealed) setRevealed(true)

    return (
        <AnimatePresence initial={false}>
            {!revealed && !ready && (
                <motion.div key="app-boot-cover" exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.2 }} className="absolute inset-0 z-[60]">
                    <AppLoader />
                </motion.div>
            )}
        </AnimatePresence>
    )
}
