import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { ArrowLeftIcon, ChevronRightIcon, type LucideIcon } from '@/lib/icons'

export function TemplateSectionHeading({ title, subtitle, icon, onSelect, onBack }: { title: string; subtitle?: string; icon?: LucideIcon; onSelect?: () => void; onBack?: () => void }) {
    const t = useTranslations('templates.section')
    if (!onSelect) {
        return (
            <div className="mb-4 flex items-center gap-2">
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
                    <span aria-hidden className="grid grid-cols-[0fr] overflow-hidden transition-[grid-template-columns] duration-200 ease-out group-focus-within:grid-cols-[1fr] group-hover:grid-cols-[1fr]">
                        <span className="min-w-0 overflow-hidden pl-1">
                            <ChevronRightIcon className="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,translate] duration-200 ease-out group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:translate-x-0 group-hover:opacity-100" />
                        </span>
                    </span>
                </h2>
                {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            <button type="button" onClick={onSelect} aria-label={t('filterBy', { title })} className="absolute -inset-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
    )
}
