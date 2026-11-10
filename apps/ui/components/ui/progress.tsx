import { cn } from '@/lib/utils'
import { Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { CSSProperties } from 'react'

type ProgressProps = {
    value?: number | null
    size?: 'xs' | 'sm' | 'md'
    tone?: 'brand' | 'warning' | 'destructive'
    label?: string
    className?: string
}

const HEIGHTS = { xs: 'h-0.5', sm: 'h-1', md: 'h-1.5' } as const
const ACCENTS = { brand: 'var(--color-brand)', warning: 'var(--color-amber-500)', destructive: 'var(--destructive)' } as const

export function Progress({ value, size = 'xs', tone = 'brand', label, className }: ProgressProps) {
    const t = useTranslations('ui.upload')
    const determinate = typeof value === 'number'
    const percent = determinate ? Math.min(100, Math.max(0, value)) : 0
    const accent = ACCENTS[tone]
    const fill: CSSProperties = { backgroundImage: `linear-gradient(90deg, color-mix(in oklab, ${accent}, white var(--progress-highlight)), ${accent})` }
    // Les hachures maison, posées sur le remplissage et éteintes vers la droite : la queue de la barre
    // est texturée, la tête reste une couleur pleine, ce qui donne à la barre l'air de se solidifier.
    // Pas de trame par défaut : sur 6 px de haut elle ne donne qu'une poignée de blocs, il faut resserrer.
    const stripes = <Stripes fade="right" color="var(--progress-stripe-ink)" band={7} period={15} />

    return (
        <div
            role="progressbar"
            aria-label={label ?? t('progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={determinate ? Math.round(percent) : undefined}
            // The track is a tint of the text color rather than `bg-muted`: these bars sit inside
            // composer chips and trays that are themselves `bg-muted`, where a muted track vanishes.
            className={cn('relative w-full overflow-hidden rounded-full bg-muted-foreground/25', HEIGHTS[size], className)}
        >
            {determinate ? (
                <div className="progress-fill relative h-full overflow-hidden rounded-full transition-[width] duration-200 ease-out" style={{ ...fill, width: `${percent}%` }}>
                    {stripes}
                </div>
            ) : (
                <div className="progress-fill progress-indeterminate absolute inset-y-0 w-2/5 overflow-hidden rounded-full" style={fill}>
                    {stripes}
                </div>
            )}
        </div>
    )
}
