'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import type { PlaceholderEffect } from './placeholder-effects'

const HOLD_MS = 2400
const TYPE_MS = 55
const ERASE_MS = 30
const TYPED_HOLD_MS = 1400
const ERASED_HOLD_MS = 300

const SWAPS = {
    roll: { initial: { y: '0.5em', opacity: 0, filter: 'blur(4px)' }, animate: { y: 0, opacity: 1, filter: 'blur(0px)' }, exit: { y: '-0.5em', opacity: 0, filter: 'blur(4px)' } },
    fade: { initial: { opacity: 0, filter: 'blur(6px)' }, animate: { opacity: 1, filter: 'blur(0px)' }, exit: { opacity: 0, filter: 'blur(6px)' } },
}

const LETTERS = { hidden: {}, shown: { transition: { staggerChildren: 0.025 } } }
const LETTER = { hidden: { opacity: 0, y: '0.3em' }, shown: { opacity: 1, y: 0 } }

// The empty name field, giving ideas rather than one example: the names of the pills under it, one
// after the other. It inherits its type and colour from the line it sits in.
export function NamePlaceholder({ names, effect }: { names: string[]; effect: PlaceholderEffect }) {
    const t = useTranslations('dialogs.newBox')
    const reducedMotion = useReducedMotion()
    const still = effect === 'static' || reducedMotion || names.length < 2

    if (still) return names[0] ?? t('placeholderName')
    if (effect === 'type') return <TypedName names={names} />
    if (effect === 'letters') return <SpelledName names={names} />
    return <SwappedName names={names} swap={SWAPS[effect]} />
}

function useNameCycle(names: string[]) {
    const [index, setIndex] = useState(0)

    useEffect(() => {
        const timer = setInterval(() => setIndex(current => current + 1), HOLD_MS)
        return () => clearInterval(timer)
    }, [])

    return names[index % names.length]
}

function SwappedName({ names, swap }: { names: string[]; swap: (typeof SWAPS)[keyof typeof SWAPS] }) {
    const name = useNameCycle(names)
    return (
        <span className="relative inline-block">
            <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={name} className="inline-block" initial={swap.initial} animate={swap.animate} exit={swap.exit} transition={{ duration: 0.35, ease: 'easeOut' }}>
                    {name}
                </motion.span>
            </AnimatePresence>
        </span>
    )
}

function SpelledName({ names }: { names: string[] }) {
    const name = useNameCycle(names)
    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.span key={name} className="inline-block" variants={LETTERS} initial="hidden" animate="shown" exit={{ opacity: 0, transition: { duration: 0.15 } }}>
                {Array.from(name).map((letter, position) => (
                    <motion.span key={position} className="inline-block" variants={LETTER} transition={{ duration: 0.25, ease: 'easeOut' }}>
                        {letter}
                    </motion.span>
                ))}
            </motion.span>
        </AnimatePresence>
    )
}

// Opens on the first name whole, so the field never starts empty, then erases it and types the next.
function TypedName({ names }: { names: string[] }) {
    const [{ index, length, erasing }, setStroke] = useState({ index: 0, length: names[0].length, erasing: false })
    const name = names[index % names.length]
    const whole = length >= name.length

    useEffect(() => {
        const delay = erasing ? (length === 0 ? ERASED_HOLD_MS : ERASE_MS) : whole ? TYPED_HOLD_MS : TYPE_MS
        const timer = setTimeout(() => {
            setStroke(stroke => {
                if (!stroke.erasing) return whole ? { ...stroke, erasing: true } : { ...stroke, length: stroke.length + 1 }
                if (stroke.length > 0) return { ...stroke, length: stroke.length - 1 }
                return { index: stroke.index + 1, length: 0, erasing: false }
            })
        }, delay)
        return () => clearTimeout(timer)
    }, [erasing, length, whole])

    return name.slice(0, length)
}
