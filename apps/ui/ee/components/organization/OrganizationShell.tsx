'use client'

import { HScrollFade, ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useRef, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { ArrowLeftIcon, CoinsIcon, GlobeIcon, LayersIcon, TagIcon, TriangleAlertIcon, UsersIcon, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { SquareLogo } from './SquareLogo'
import type { ConsoleSection, OrganizationIdentity } from './types'

const SECTIONS: { id: ConsoleSection; icon: LucideIcon }[] = [
    { id: 'workspaces', icon: LayersIcon },
    { id: 'credit', icon: CoinsIcon },
    { id: 'team', icon: UsersIcon },
    { id: 'brand', icon: TagIcon },
    { id: 'domains', icon: GlobeIcon },
]

type OrganizationShellProps = {
    organization: OrganizationIdentity
    active: ConsoleSection
    // The sections it shows: the ones that have a page.
    hrefs: Partial<Record<ConsoleSection, string>>
    backHref: string
    suspended?: boolean
    children: ReactNode
}

export function OrganizationShell({ organization, active, hrefs, backHref, suspended = false, children }: OrganizationShellProps) {
    const t = useTranslations('organization')
    const sections = SECTIONS.flatMap(section => {
        const href = hrefs[section.id]
        return href ? [{ ...section, href }] : []
    })
    return (
        <div className="flex h-dvh flex-col bg-background text-foreground lg:flex-row">
            <aside className="hidden w-60 shrink-0 flex-col border-e bg-muted/20 lg:flex">
                <Identity organization={organization} className="p-4" />
                <nav aria-label={t('nav.label')} className="flex min-h-0 flex-1 flex-col">
                    <ScrollFade className="min-h-0 flex-1 px-2">
                        <div className="space-y-0.5">
                    {sections.map(({ id, href, icon: Icon }) => (
                        <Link key={id} href={href} aria-current={id === active ? 'page' : undefined} className={cn('flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors', id === active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
                            <Icon className="size-4 shrink-0" />
                            <span className="truncate">{t(`nav.${id}`)}</span>
                        </Link>
                    ))}
                        </div>
                    </ScrollFade>
                </nav>
                <div className="border-t p-2">
                    <Link href={backHref} className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
                        <ArrowLeftIcon className="size-4 shrink-0" />
                        <span className="truncate">{t('nav.back')}</span>
                    </Link>
                </div>
            </aside>

            <div className="shrink-0 border-b pt-[env(safe-area-inset-top)] lg:hidden">
                <div className="flex items-center gap-2 py-2 pe-4 ps-2">
                    <Link href={backHref} aria-label={t('nav.back')} className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}>
                        <ArrowLeftIcon />
                    </Link>
                    <Identity organization={organization} />
                </div>
                <nav aria-label={t('nav.label')}>
                    <HScrollFade fadeClassName="from-background" className="gap-0 px-2">
                        {sections.map(({ id, href }) => (
                            <SectionTab key={id} href={href} active={id === active} label={t(`nav.${id}`)} />
                        ))}
                    </HScrollFade>
                </nav>
            </div>

            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                {suspended && (
                    <div className="mx-auto w-full max-w-5xl shrink-0 px-4 pt-4 sm:px-8">
                        <Alert variant="warning" animated={false} glow={false}>
                            <TriangleAlertIcon />
                            <AlertTitle>{t('suspended.title')}</AlertTitle>
                            <AlertDescription>{t('suspended.description')}</AlertDescription>
                        </Alert>
                    </div>
                )}
                {children}
            </main>
        </div>
    )
}

function Identity({ organization, className }: { organization: OrganizationIdentity; className?: string }) {
    return (
        <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
            <SquareLogo name={organization.name} iconUrl={organization.iconUrl} className="size-8" />
            <span className="truncate text-sm font-semibold">{organization.name}</span>
        </div>
    )
}

function SectionTab({ href, active, label }: { href: string; active: boolean; label: string }) {
    const ref = useRef<HTMLAnchorElement>(null)
    useEffect(() => {
        if (active) ref.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
    }, [active])
    return (
        <Link
            ref={ref}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn('relative flex h-11 shrink-0 items-center px-3 text-sm font-medium whitespace-nowrap transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full', active ? 'text-foreground after:bg-primary' : 'text-muted-foreground hover:text-foreground')}
        >
            {label}
        </Link>
    )
}
