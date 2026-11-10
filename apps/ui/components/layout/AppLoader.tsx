import { AnimatedLogo } from '@/components/layout/Logo'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export function AppLoader({ className }: { className?: string }) {
    const t = useTranslations('layout')
    return (
        <div className={cn('flex flex-col items-center justify-center gap-4 h-full bg-background', className)}>
            <AnimatedLogo size="3xl" frame={false} />
            <Shimmer as="span" duration={1.6} className="text-sm [--color-muted-foreground:#a3a3a3] [--color-background:#ffffff]">
                {t('loading')}
            </Shimmer>
        </div>
    )
}
