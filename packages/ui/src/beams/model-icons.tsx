import type { ComponentType } from 'react'
import { cn } from '../cn'
import { MODEL_LOGOS, type ModelLogoSlug } from './model-logos'

type GlyphProps = { className?: string }

export const MODEL_ICONS = Object.fromEntries(
    Object.entries(MODEL_LOGOS).map(([slug, logo]) => [
        slug,
        function ModelIcon({ className }: GlyphProps) {
            return (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn('text-charcoal-700 dark:text-neutral-100', className)}>
                    {logo.paths.map(d => (
                        <path key={d.slice(0, 24)} d={d} fillRule={'evenodd' in logo && logo.evenodd ? 'evenodd' : undefined} />
                    ))}
                </svg>
            )
        },
    ]),
) as Record<ModelLogoSlug, ComponentType<GlyphProps>>
