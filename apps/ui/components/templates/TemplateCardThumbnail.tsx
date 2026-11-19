import { Icon } from '@/components/ui/icon'
import { LayersIcon } from '@/lib/icons'
import type { TemplateCardImage } from '@/lib/templates/card-image'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

// The thumbnail of a template card, shared by the grid card and the featured one. A board comes as
// a pair of captures and is swapped in CSS: these cards are rendered on the server, so reading the
// theme in JS would cost a flash of the wrong one at first paint.
export function TemplateCardThumbnail({ image, fit = 'cover', fade, className, children }: { image: TemplateCardImage | null; fit?: 'cover' | 'contain'; fade?: 'bottom' | 'row'; className?: string; children?: React.ReactNode }) {
    // Spelled out rather than interpolated: Tailwind only sees class names it can read in the source.
    const objectFit = fit === 'contain' ? 'object-contain' : 'object-cover'
    const t = useTranslations('templates')
    const alt = image?.kind === 'board' ? t('boardAlt', { title: image.alt }) : image?.alt

    return (
        <div
            className={cn(
                'relative flex items-center justify-center overflow-hidden',
                // The frame is captured on the brand near-black (or its light twin), so any part of
                // it left uncovered has to be the same colour as the capture's own background.
                image?.kind === 'board' ? 'bg-[#fafafa] dark:bg-[#0a0a0a]' : 'bg-muted/40',
                // A mask, not a gradient painted on top: the capture's own near-black and the card
                // body are two different colours, and only fading the frame itself to transparent
                // lets whatever sits behind take over, tint of a selected card included. The edge to
                // fade is the one the body sits against, so a card that turns from stacked to
                // side by side turns its fade with it. The horizontal one is the shorter of the
                // two: a board fitted to its width reaches that edge, where a fitted one leaves
                // bars under its bottom.
                fade === 'bottom' && 'mask-b-from-80%',
                fade === 'row' && 'max-sm:mask-b-from-80% sm:mask-r-from-90%',
                className,
            )}
        >
            {image ? (
                <>
                    {image.lightSrc && (
                        <img src={image.lightSrc} alt={alt} loading="lazy" decoding="async" className={cn('block size-full dark:hidden', objectFit)} />
                    )}
                    <img
                        src={image.src}
                        alt={alt}
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
