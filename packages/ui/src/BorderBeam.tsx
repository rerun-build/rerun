import type { CSSProperties } from 'react'
import { clsx } from 'clsx'

export interface BorderBeamProps {
    /** Gradient shape: 'ring' (a full alternating ring) or 'arcs' (two opposite sweeping
     *  arcs, bright at +36 and +216 degrees from `angle`). Defaults to 'arcs'. */
    pattern?: 'ring' | 'arcs'
    /** Color preset. Defaults to 'neutral'. */
    tone?: 'brand' | 'white' | 'neutral' | 'green' | 'red' | 'orange' | 'cyan' | 'yellow'
    /** Whether the gradient spins. Defaults to false. */
    animated?: boolean
    /** Add a tight drop-shadow so the border itself glows. Defaults to false. */
    glow?: boolean
    /** Border thickness in px. Defaults to 1. */
    width?: number
    /** Spin duration in seconds (animated only). Defaults to 6. */
    duration?: number
    /** Static start angle in degrees (used when not animated). Defaults to 220. */
    angle?: number
    /** Border radius. Defaults to 'inherit' (follows the parent). */
    radius?: string
    /** How far the ring extends past the parent's padding box, in px. Set it to the parent's
     *  border-width so the ring lands on the border instead of inside it. Defaults to 0. */
    outset?: number
    className?: string
    style?: CSSProperties
}

/**
 * Animated (or static) gradient border, rendered as an absolutely-positioned
 * overlay masked down to a `width`px ring. Drop it inside any `position: relative`
 * element. Pure CSS (the keyframe + presets live in `@rerun/ui/styles.css`), so it
 * works in Server Components.
 *
 * Centralizes the conic-gradient border effect used across the landing page
 * (shiny pills, glass checkmarks, model marquee, CTA buttons, comparison glow,
 * use-case cards).
 */
export function BorderBeam({
    pattern = 'arcs',
    tone = 'neutral',
    animated = false,
    glow = false,
    width = 1,
    duration = 6,
    angle = 220,
    radius = 'inherit',
    outset = 0,
    className,
    style,
}: BorderBeamProps) {
    return (
        <span
            aria-hidden
            // NB: plain clsx, NOT cn()/twMerge — tailwind-merge treats these custom
            // `border-beam*` classes as conflicting `border-*` utilities and collapses
            // them to one, which strips the gradient/mask and renders nothing.
            className={clsx(
                'border-beam',
                `border-beam--${pattern}`,
                `border-beam--${tone}`,
                animated && 'border-beam--spin',
                glow && 'border-beam--glow',
                className,
            )}
            style={
                {
                    borderRadius: radius,
                    '--beam-w': `${width}px`,
                    '--beam-outset': `${outset}px`,
                    '--beam-dur': `${duration}s`,
                    // Static variants pin the gradient angle; animated ones start at 0deg
                    // and turn as a whole (`.border-beam--spin::before`).
                    ...(animated ? {} : { '--border-beam-angle': `${angle}deg` }),
                    ...style,
                } as CSSProperties
            }
        />
    )
}
