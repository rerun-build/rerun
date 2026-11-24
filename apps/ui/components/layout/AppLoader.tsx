import { BrandLoadingLogo } from '@/components/brand/BrandLogo'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export function AppLoader({ className }: { className?: string }) {
    const t = useTranslations('layout')
    return (
        <div className={cn('flex flex-col items-center justify-center gap-4 h-full bg-background', className)}>
            <BrandLoadingLogo />
            <Shimmer as="span" duration={1.6} className="text-sm [--color-muted-foreground:#a3a3a3] [--color-background:#ffffff]">
                {t('loading')}
            </Shimmer>
        </div>
    )
}
