import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { ArrowLeftIcon, ChevronRightIcon, type LucideIcon } from '@/lib/icons'

// The one place the library's section titles are sized: the sections spread over a scrolling column
// only read as separate blocks if their headings are identical and heavier than the cards under
// them. A heading given `onSelect` is the way into its own section, which the category shelves use
// to narrow the library down to themselves; one given `onBack` is the way out of the narrowed
// catalogue those shelves lead to.
export function TemplateSectionHeading({ title, subtitle, icon, onSelect, onBack }: { title: string; subtitle?: string; icon?: LucideIcon; onSelect?: () => void; onBack?: () => void }) {
    const t = useTranslations('templates.section')
    if (!onSelect) {
        return (
            <div className="mb-4 flex items-center gap-2">
                {/* Centred on the whole block, title and subtitle together, rather than sitting on the
                    first line: the heading reads as one thing with a way out beside it. Flush with the
                    column too, never pulled into its padding by an optical margin: this sits inside a
                    scroller that clips horizontally, and half the hover pill would be cut off. */}
                {onBack && (
                    <Button type="button" variant="ghost" size="icon-lg" aria-label={t('back')} onClick={onBack} className="shrink-0 text-muted-foreground">
                        <ArrowLeftIcon className="size-5" />
                    </Button>
                )}
                <div className="min-w-0">
                    <h2 className="font-heading text-lg leading-tight font-semibold tracking-tight">{title}</h2>
                    {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
                </div>
            </div>
        )
    }
    return (
        <div className="group relative mb-4 flex w-fit items-start gap-3">
            {icon && <Icon icon={icon} size="md" />}
            <div className="min-w-0">
                <h2 className="font-heading flex items-center text-lg leading-tight font-semibold tracking-tight transition-colors group-hover:text-foreground/70">
                    {title}
                    {/* The affordance is the chevron arriving, not the title moving. It unfolds from
                        behind the title rather than fading in on a reserved slot: the title then sits
                        tight against nothing at rest, and the reveal has somewhere to travel. Width
                        animates through `grid-template-columns`, the one way to go from nothing to
                        content width in CSS, same as the mode tabs. */}
                    <span aria-hidden className="grid grid-cols-[0fr] overflow-hidden transition-[grid-template-columns] duration-200 ease-out group-focus-within:grid-cols-[1fr] group-hover:grid-cols-[1fr]">
                        <span className="min-w-0 overflow-hidden pl-1">
                            {/* `translate`, not `transform`: Tailwind v4 compiles `-translate-x-1` to the
                                `translate` property, so a transition listed on `transform` never fires and
                                the chevron pops in instead of sliding. */}
                            <ChevronRightIcon className="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,translate] duration-200 ease-out group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:translate-x-0 group-hover:opacity-100" />
                        </span>
                    </span>
                </h2>
                {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {/* The button lies over the block rather than wrapping it: both `<button>` and `<h2>` only
                take phrasing content, so a heading and a paragraph cannot live inside one. This way the
                icon and the subtitle are part of the target too, and `w-fit` keeps the empty half of the
                row out of it. */}
            <button type="button" onClick={onSelect} aria-label={t('filterBy', { title })} className="absolute -inset-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
    )
}
