'use client'

import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatWeekRange } from '@/lib/rewind/format'
import { weekEndOf } from '@/lib/rewind/week'
import { cn } from '@/lib/utils'
import { useRewindStore } from '@/stores/rewind.store'

// The story overlay sits at z-[100]; the portalled list has to clear it.
const CONTENT_LAYER = 'z-[110]'

export function RewindWeekPicker({ currentId, onOpenChange, className }: { currentId: string; onOpenChange: (open: boolean) => void; className?: string }) {
    const locale = useLocale()
    const t = useTranslations('rewind.weekPicker')
    const weeks = useRewindStore(s => s.weeks)
    const loadingWeek = useRewindStore(s => s.loadingWeek)
    const openWeek = useRewindStore(s => s.openWeek)

    return (
        <Select value={loadingWeek ?? currentId} onValueChange={id => void openWeek(id)} onOpenChange={onOpenChange}>
            <SelectTrigger
                size="sm"
                aria-label={t('label')}
                onPointerDown={event => event.stopPropagation()}
                className={cn('pointer-events-auto gap-1.5 rounded-full border-white/15 bg-white/10 text-white hover:bg-white/20 dark:bg-white/10 dark:hover:bg-white/20 [&_svg]:text-white/70', loadingWeek && 'animate-pulse', className)}
            >
                <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="center" className={cn(CONTENT_LAYER, 'max-h-72')}>
                {weeks.map((week, index) => (
                    <SelectItem key={week.id} value={week.id} className="text-xs">
                        {formatWeekRange(week.weekStart, weekEndOf(week.weekStart), locale)}
                        {index === 0 && !week.viewed && (
                            <Badge tone="brand" size="sm">
                                {t('new')}
                            </Badge>
                        )}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
