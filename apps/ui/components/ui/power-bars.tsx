import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

type PowerBarsProps = {
    // Capability rating on a 1..max scale. Undefined/0 renders nothing.
    power?: number
    max?: number
    size?: 'sm' | 'md'
    className?: string
}

// Ascending signal-style bars showing a model's relative power. The first `power`
// bars are filled; the rest are faint. Bar heights grow left-to-right.
export function PowerBars({ power, max = 6, size = 'sm', className }: PowerBarsProps) {
    const t = useTranslations('ui')
    if (!power) return null
    const filled = Math.min(power, max)

    return (
        <span role="img" aria-label={t('powerBars', { filled, max })} className={cn('flex items-end', size === 'sm' ? 'gap-px' : 'gap-0.5', className)}>
            {Array.from({ length: max }).map((_, i) => (
                <span
                    key={i}
                    className={cn(size === 'sm' ? 'w-0.5 rounded-[1px]' : 'w-[3px] rounded-[1.5px]', i < filled ? 'bg-foreground' : 'bg-muted-foreground/30')}
                    style={{ height: size === 'sm' ? `${4 + i * 2}px` : `${6 + i * 3}px` }}
                />
            ))}
        </span>
    )
}
