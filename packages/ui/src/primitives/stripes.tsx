import { cn } from '../cn'

const DEFAULT_COLOR = 'var(--stripes-ink)'
const DEFAULT_BAND = 10
const DEFAULT_PERIOD = 21
const stripesBg = (color: string, band: number, period: number) => `repeating-linear-gradient(65deg, ${color} 0 ${band}px, transparent ${band}px ${period}px)`
const FADES = {
    bottom: 'linear-gradient(to bottom, black, transparent)',
    top: 'linear-gradient(to top, black, transparent)',
    right: 'linear-gradient(to right, black, transparent)',
    vertical: 'linear-gradient(to bottom, transparent, black 50%, transparent)',
} as const

const SOFT_STOPS: [number, number][] = [
    [0, 1],
    [0.2, 0.78],
    [0.45, 0.45],
    [0.7, 0.16],
    [1, 0],
]
const edgesFade = (width: number) => (['right', 'left', 'bottom', 'top'] as const).map(side => `linear-gradient(to ${side}, ${SOFT_STOPS.map(([at, alpha]) => `rgb(0 0 0 / ${alpha}) ${Math.round(at * width)}px`).join(', ')})`).join(', ')

export function Stripes({
    className,
    fade = 'bottom',
    edgeWidth = 96,
    color = DEFAULT_COLOR,
    band = DEFAULT_BAND,
    period = DEFAULT_PERIOD,
}: {
    className?: string
    fade?: keyof typeof FADES | 'edges'
    edgeWidth?: number
    color?: string
    band?: number
    period?: number
}) {
    const mask = fade === 'edges' ? edgesFade(edgeWidth) : FADES[fade]
    return (
        <span
            aria-hidden
            className={cn('pointer-events-none absolute inset-0', className)}
            style={{ backgroundImage: stripesBg(color, band, period), maskImage: mask, WebkitMaskImage: mask }}
        />
    )
}
