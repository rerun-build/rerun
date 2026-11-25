'use client'

import { formatCredits } from '@rerun/contracts'
import { HScrollFade } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useRef, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { CONSOLE_HOME, CONSOLE_NEW_WORKSPACE, consoleWorkspacePath } from '@/ee/lib/organizations/console-routes'
import { ArrowLeftIcon, ChevronsUpDownIcon, PlusIcon, TriangleAlertIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import type { ConsoleViewer } from './ConsoleProvider'
import { Face } from './parts'
import { SquareLogo } from './SquareLogo'
import type { ConsoleSection, ConsoleWorkspace, OrganizationIdentity } from './types'

const SECTIONS: ConsoleSection[] = ['workspaces', 'credit', 'brand', 'domains', 'team']

type OrganizationShellProps = {
    organization: OrganizationIdentity
    active: ConsoleSection
    // The sections it shows: the ones that have a page.
    hrefs: Partial<Record<ConsoleSection, string>>
    backHref: string
    suspended?: boolean
    viewer: ConsoleViewer | null
    // Null while they are read.
    reserveMicros: number | null
    alerts: number
    // The workspace whose page is open, and the ones it can be changed for.
    current?: { workspace: ConsoleWorkspace; workspaces: ConsoleWorkspace[] }
    children: ReactNode
}

export function OrganizationShell({ organization, active, hrefs, backHref, suspended = false, viewer, reserveMicros, alerts, current, children }: OrganizationShellProps) {
    const t = useTranslations('organization')
    return (
        <div className="flex h-dvh flex-col bg-background text-foreground">
            <header className="shrink-0 px-2 pt-[env(safe-area-inset-top)] sm:px-4">
                <div className="flex h-12 items-center">
                    <div className="flex min-w-0 items-center gap-1">
                        <Link href={CONSOLE_HOME} aria-label={organization.name} className={cn('flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium', current && 'max-sm:shrink-0')}>
                            <SquareLogo name={organization.name} iconUrl={organization.iconUrl} className="size-6 rounded-md" />
                            <span className={cn('truncate', current && 'max-sm:hidden')}>{organization.name}</span>
                        </Link>
                        {current && (
                            <>
                                <span aria-hidden className="text-border">
                                    /
                                </span>
                                <WorkspaceSwitcher {...current} />
                            </>
                        )}
                    </div>
                    <Account hrefs={hrefs} backHref={backHref} viewer={viewer} reserveMicros={reserveMicros} />
                </div>
                <nav aria-label={t('nav.label')}>
                    <HScrollFade fadeClassName="from-background" className="gap-0">
                        {SECTIONS.map(id => {
                            const href = hrefs[id]
                            return href && <SectionTab key={id} href={href} active={id === active} label={t(`nav.${id}`)} alerts={id === 'workspaces' ? alerts : 0} />
                        })}
                    </HScrollFade>
                </nav>
            </header>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-card sm:mx-2">
                {suspended && (
                    <div className="mx-auto w-full max-w-6xl shrink-0 px-4 pt-4 sm:px-8">
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

function WorkspaceSwitcher({ workspace, workspaces }: { workspace: ConsoleWorkspace; workspaces: ConsoleWorkspace[] }) {
    const t = useTranslations('organization.nav')
    return (
        <DropdownMenu>
            <DropdownMenuTrigger aria-label={t('switch', { name: workspace.name })} className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors hover:bg-muted">
                <span className="truncate">{workspace.name}</span>
                <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-72">
                {workspaces.map(({ id, name, iconUrl }) => (
                    <DropdownMenuItem key={id} asChild>
                        <Link href={consoleWorkspacePath(id)} aria-current={id === workspace.id ? 'page' : undefined}>
                            <SquareLogo name={name} iconUrl={iconUrl} className="size-5 rounded-md text-[9px]" />
                            <span className={cn('truncate', id === workspace.id && 'font-medium')}>{name}</span>
                        </Link>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function Account({ hrefs, backHref, viewer, reserveMicros }: Pick<OrganizationShellProps, 'hrefs' | 'backHref' | 'viewer' | 'reserveMicros'>) {
    const t = useTranslations('organization')
    const locale = useLocale()
    const name = viewer?.name ?? viewer?.email ?? ''
    return (
        <div className="ms-auto flex shrink-0 items-center gap-1 ps-2">
            {reserveMicros === null ? (
                <Skeleton className="mx-2 h-4 w-24" />
            ) : (
                <Link href={hrefs.credit ?? CONSOLE_HOME} className="rounded-lg px-2 py-1.5 text-sm tabular-nums transition-colors hover:bg-muted">
                    {t.rich('nav.reserve', { amount: formatCredits(reserveMicros, locale), hint: chunks => <span className="text-muted-foreground max-sm:hidden">{chunks}</span> })}
                </Link>
            )}
            <Link href={CONSOLE_NEW_WORKSPACE} aria-label={t('workspaces.new')} className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
                <PlusIcon />
            </Link>
            <DropdownMenu>
                <DropdownMenuTrigger aria-label={t('nav.account')} className="ms-1 flex size-9 items-center justify-center rounded-full transition-colors hover:bg-muted">
                    {viewer ? <Face name={name} photo={viewer.photo} className="size-7" /> : <Skeleton className="size-7 rounded-full" />}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    {name && (
                        <>
                            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{name}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                        </>
                    )}
                    <DropdownMenuItem asChild>
                        <Link href={backHref}>
                            <ArrowLeftIcon />
                            {t('nav.back')}
                        </Link>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}

function SectionTab({ href, active, label, alerts }: { href: string; active: boolean; label: string; alerts: number }) {
    const t = useTranslations('organization.nav')
    const ref = useRef<HTMLAnchorElement>(null)
    useEffect(() => {
        if (active) ref.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
    }, [active])
    return (
        <Link
            ref={ref}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn('relative flex h-11 shrink-0 items-center gap-1.5 px-2.5 text-sm whitespace-nowrap transition-colors after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full md:h-10', active ? 'font-medium text-foreground after:bg-brand' : 'text-muted-foreground hover:text-foreground')}
        >
            {label}
            {alerts > 0 && (
                <span aria-label={t('alerts', { count: alerts })} className="text-xs font-medium text-destructive tabular-nums">
                    {alerts}
                </span>
            )}
        </Link>
    )
}
