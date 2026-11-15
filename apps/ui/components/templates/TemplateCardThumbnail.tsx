import { Icon } from '@/components/ui/icon'
import { LayersIcon } from '@/lib/icons'
import type { TemplateCardImage } from '@/lib/templates/card-image'
import { cn } from '@/lib/utils'

export function TemplateCardThumbnail({ image, fit = 'cover', fade, className, children }: { image: TemplateCardImage | null; fit?: 'cover' | 'contain'; fade?: 'bottom' | 'row'; className?: string; children?: React.ReactNode }) {
    const objectFit = fit === 'contain' ? 'object-contain' : 'object-cover'

    return (
        <div
            className={cn(
                'relative flex items-center justify-center overflow-hidden',
                image?.kind === 'board' ? 'bg-[#fafafa] dark:bg-[#0a0a0a]' : 'bg-muted/40',
                fade === 'bottom' && 'mask-b-from-80%',
                fade === 'row' && 'max-sm:mask-b-from-80% sm:mask-r-from-90%',
                className,
            )}
        >
            {image ? (
                <>
                    {image.lightSrc && (
                        <img src={image.lightSrc} alt={image.alt} loading="lazy" decoding="async" className={cn('block size-full dark:hidden', objectFit)} />
                    )}
                    <img
                        src={image.src}
                        alt={image.alt}
                        loading="lazy"
                        decoding="async"
                        className={cn('size-full', image.lightSrc && 'hidden dark:block', objectFit)}
                    />
                </>
            ) : (
                <Icon icon={LayersIcon} size="md" className="opacity-40" />
            )}
            {children}
        </div>
    )
}
