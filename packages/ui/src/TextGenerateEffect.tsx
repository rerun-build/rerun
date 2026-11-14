'use client'

import { motion, useReducedMotion } from 'motion/react'
import { cn } from './cn'

export function TextGenerateEffect({
    text,
    className,
    duration = 0.5,
    stagger = 0.09,
    delay = 0,
    blur = 8,
}: {
    text: string
    className?: string
    duration?: number
    stagger?: number
    delay?: number
    blur?: number
}) {
    const reduceMotion = useReducedMotion() ?? false
    const words = text.split(' ')

    if (reduceMotion) return <span className={className}>{text}</span>

    return (
        <motion.span
            className={cn('inline', className)}
            initial="hidden"
            animate="visible"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
        >
            {words.map((word, index) => (
                <span key={`${word}-${index}`}>
                    <motion.span
                        className="inline-block"
                        variants={{ hidden: { opacity: 0, filter: `blur(${blur}px)` }, visible: { opacity: 1, filter: 'blur(0px)' } }}
                        transition={{ duration, ease: 'easeOut' }}
                    >
                        {word}
                    </motion.span>
                    {index < words.length - 1 && ' '}
                </span>
            ))}
        </motion.span>
    )
}
