'use client'

import { CardAvatar } from '@rerun/ui/chat'
import { TemplateBoardPreview, type BoardAgent } from '@rerun/ui/iso-grid'
import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckIcon, CopyIcon, SearchIcon } from '@/lib/icons'
import { useCopy } from '@/lib/use-copy'
import { cn } from '@/lib/utils'

import { INITIALS } from './SquareLogo'
import type { ConsoleWorkspace } from './types'

const asIs = (path: string) => path

export function Face({ name, photo, className }: { name: string; photo?: string | null; className?: string }) {
    return <CardAvatar src={photo} fileUrl={asIs} name={name} className={cn('size-8 shrink-0', INITIALS, className)} />
}

type PageProps = { width?: string; footer?: ReactNode; children: ReactNode }

export function Page({ width = 'max-w-6xl', footer, children }: PageProps) {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ScrollFade className="min-h-0 flex-1">
                <div className={cn('mx-auto w-full px-4 py-6 sm:px-8 sm:py-10', width)}>{children}</div>
            </ScrollFade>
            {footer}
        </div>
    )
}

export function Heading({ title, meta, actions }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
    return (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <h1 className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 text-2xl font-medium tracking-tight">
                {title}
                {meta && <span className="text-sm font-normal tracking-normal text-muted-foreground tabular-nums">{meta}</span>}
            </h1>
            {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
    )
}

export function Section({ title, meta, actions, children, className }: { title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cn('min-w-0', className)}>
            <div className="flex min-h-9 items-center justify-between gap-3 border-b border-border pb-2">
                <h2 className="flex min-w-0 items-baseline gap-2 text-sm font-medium">
                    <span className="truncate">{title}</span>
                    {meta !== undefined && <span className="font-normal text-muted-foreground tabular-nums">{meta}</span>}
                </h2>
                {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </div>
            {children}
        </section>
    )
}

export function Search({ label, value, onChange, className }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
    return (
        <div className={cn('relative min-w-0', className)}>
            <SearchIcon className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)} className="h-8 ps-8 [&::-webkit-search-cancel-button]:hidden" />
        </div>
    )
}

export function CopyButton({ value, label }: { value: string; label: string }) {
    const { copied, copy } = useCopy()
    return (
        <Button variant="ghost" size="icon-sm" aria-label={label} className="shrink-0 text-muted-foreground" onClick={() => copy(value)}>
            {copied ? <CheckIcon className="text-emerald-500" /> : <CopyIcon />}
        </Button>
    )
}

export function Dot({ tone, className }: { tone: 'red' | 'amber' | 'green' | 'neutral'; className?: string }) {
    const color = { red: 'bg-destructive', amber: 'bg-amber-500', green: 'bg-emerald-500', neutral: 'bg-muted-foreground' }[tone]
    return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', color, className)} />
}

// A hundred boards are not drawn for the three on screen: each one mounts as it comes near, and stays.
function useNear<Element extends HTMLElement>() {
    const ref = useRef<Element>(null)
    const [near, setNear] = useState(false)
    useEffect(() => {
        const element = ref.current
        if (!element || near) return
        const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), { rootMargin: '200px' })
        observer.observe(element)
        return () => observer.disconnect()
    }, [near])
    return { ref, near }
}

export function ClientBoard({ workspace, maxZoom = 0.9, className }: { workspace: ConsoleWorkspace; maxZoom?: number; className?: string }) {
    const t = useTranslations('organization.workspaces')
    const { ref, near } = useNear<HTMLDivElement>()
    const { coworkers } = workspace
    const agents = useMemo<BoardAgent[]>(() => coworkers.map(({ id, name, look, status }) => ({ key: id, name, look, status, connectorSlugs: [] })), [coworkers])
    return (
        <div ref={ref} role="img" aria-label={t('board', { name: workspace.name, count: workspace.coworkerCount })} className={cn('relative overflow-hidden bg-background', className)}>
            <div inert className="size-full">
                {near && <TemplateBoardPreview agents={agents} connectors={[]} maxZoom={maxZoom} className="pointer-events-none size-full" />}
            </div>
        </div>
    )
}
