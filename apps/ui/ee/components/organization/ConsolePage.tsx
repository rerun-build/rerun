import { ScrollFade } from '@rerun/ui/primitives'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { ArrowLeftIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type ConsolePageProps = {
    title: ReactNode
    leading?: ReactNode
    description?: string
    meta?: ReactNode
    actions?: ReactNode
    back?: { label: string; onClick: () => void }
    // Stays in view under what scrolls.
    footer?: ReactNode
    children: ReactNode
}

export function ConsolePage({ title, leading, description, meta, actions, back, footer, children }: ConsolePageProps) {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ScrollFade className="min-h-0 flex-1">
                <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
                    <div className="space-y-3">
                        {back && (
                            <Button variant="ghost" size="sm" className="-ms-2.5 text-muted-foreground" onClick={back.onClick}>
                                <ArrowLeftIcon />
                                {back.label}
                            </Button>
                        )}
                        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                            <div className={cn('flex min-w-0 flex-1 items-center gap-3', leading ? 'basis-64' : 'basis-40')}>
                                {leading}
                                <div className="min-w-0 space-y-0.5">
                                    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                                        <h1 className="line-clamp-2 min-w-0 text-lg leading-snug font-semibold break-words">{title}</h1>
                                        {meta}
                                    </div>
                                    {description && <p className="text-sm text-muted-foreground">{description}</p>}
                                </div>
                            </div>
                            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
                        </header>
                    </div>
                    {children}
                </div>
            </ScrollFade>
            {footer}
        </div>
    )
}

export function ConsoleGroup({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-2">
            <div className="flex min-h-8 items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
                {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
            {children}
        </section>
    )
}
