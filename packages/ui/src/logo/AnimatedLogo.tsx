'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../cn'
import { BuddyArt, BuddyFigure } from './buddy/art'
import { BRAND_BUDDY } from './buddy/config'

const animatedLogoVariants = cva('relative inline-flex shrink-0 items-center justify-center', {
    variants: {
        size: {
            sm: 'size-8',
            md: 'size-10',
            lg: 'size-12',
            xl: 'size-16',
            '2xl': 'size-24',
            '3xl': 'size-40',
        },
        // true: the app icon, like <Logo>. false: the Buddy on its own, for loading screens.
        frame: {
            true: 'overflow-hidden rounded-[22.37%]',
            false: '',
        },
    },
    defaultVariants: { size: 'md', frame: true },
})

type AnimatedLogoProps = React.ComponentProps<'span'> &
    VariantProps<typeof animatedLogoVariants> & {
        /** true (default): rises, then bobs for as long as it shows. false: rises once and stays. */
        loop?: boolean
        /** Length of one bob, in seconds. */
        duration?: number
    }

const KEYFRAMES = `
@keyframes rerun-buddy-rise {
  from { transform: translateY(22%) scale(0.92); opacity: 0; }
  to   { transform: none; opacity: 1; }
}
@keyframes rerun-buddy-bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-5%); }
}
@keyframes rerun-buddy-breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.05); }
}
@media (prefers-reduced-motion: reduce) {
  [data-slot="animated-logo"] [data-buddy] { animation: none !important; }
}
`

const RISE_SECONDS = 0.6

export function AnimatedLogo({ size = 'md', frame = true, loop = true, duration = 2.4, className, ...rest }: AnimatedLogoProps) {
    // In its frame the Buddy breathes instead of bobbing: a bob would bare the frame's edge.
    const idle = frame ? 'rerun-buddy-breathe' : 'rerun-buddy-bob'
    const animation = loop ? `rerun-buddy-rise ${RISE_SECONDS}s ease-out both, ${idle} ${duration}s ease-in-out ${RISE_SECONDS}s infinite` : `rerun-buddy-rise ${RISE_SECONDS}s ease-out both`
    return (
        <span data-slot="animated-logo" className={cn(animatedLogoVariants({ size, frame }), className)} {...rest}>
            <style>{KEYFRAMES}</style>
            <span data-buddy className="block size-full origin-bottom" style={{ animation }}>
                {frame ? <BuddyArt config={BRAND_BUDDY} /> : <BuddyFigure config={BRAND_BUDDY} />}
            </span>
        </span>
    )
}
