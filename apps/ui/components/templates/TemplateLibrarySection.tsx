import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowRightIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

// The one heading every block of the library's main column wears, so the page reads as a stack of
// equal sections under a single, larger page title.
export function TemplateLibrarySection({ title, subtitle, action, children, className }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cn('flex flex-col gap-4', className)}>
            <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                    <h3 className="font-heading text-base leading-tight font-semibold tracking-tight">{title}</h3>
                    {subtitle && <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{subtitle}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    )
}

export function TemplateLibrarySectionLink({ children, onClick, href }: { children: ReactNode; onClick?: () => void; href?: string }) {
    const content = (
        <>
            {children}
            <ArrowRightIcon className="size-3.5 transition-transform group-hover/link:translate-x-0.5 rtl:group-hover/link:-translate-x-0.5" />
        </>
    )
    if (href) {
        return (
            <Button asChild variant="outline" size="sm" className="group/link shrink-0 text-muted-foreground hover:text-foreground">
                <a href={href} target="_blank" rel="noreferrer">
                    {content}
                </a>
            </Button>
        )
    }
    return (
        <Button type="button" variant="outline" size="sm" onClick={onClick} className="group/link shrink-0 text-muted-foreground hover:text-foreground">
            {content}
        </Button>
    )
}
