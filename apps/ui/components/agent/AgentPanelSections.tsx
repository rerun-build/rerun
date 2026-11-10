'use client'

import { Button } from '@/components/ui/button'
import { XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import type { ComponentType, ReactNode } from 'react'

export type PanelSection<T extends string> = {
    id: string
    label: string
    icon: ComponentType<{ className?: string }>
    tabs: { id: T; label: string }[]
}

/** Un nombre s'écrit en compteur, `'dot'` en simple point rouge. */
export type PanelSectionBadges<T extends string> = Partial<Record<T, number | 'dot'>>

export function CountPastille({ count, className }: { count: number; className?: string }) {
    return <span className={cn('flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white', className)}>{count}</span>
}

export function DotPastille({ className }: { className?: string }) {
    return <span className={cn('size-2 rounded-full bg-red-500', className)} />
}

/** Les sections du panneau en largeur pleine, libellé sous l'icône. Un tap ouvre le premier onglet de la section. */
export function SectionBar<T extends string>({
    sections,
    current,
    badges,
    onSelect,
    className,
}: {
    sections: PanelSection<T>[]
    current: PanelSection<T>
    badges: PanelSectionBadges<T>
    onSelect: (id: T) => void
    className?: string
}) {
    return (
        <div className={cn('flex shrink-0 items-stretch gap-1 px-2', className)}>
            {sections.map(section => {
                const active = section.id === current.id
                const sectionBadges = section.tabs.map(tab => badges[tab.id])
                const count = sectionBadges.find(badge => typeof badge === 'number')
                return (
                    <button
                        key={section.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onSelect(section.tabs[0].id)}
                        className={cn(
                            'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors',
                            active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                        )}
                    >
                        <span className="relative">
                            <section.icon className="size-4" />
                            {!active && typeof count === 'number' && <CountPastille count={count} className="absolute -right-3 -top-1.5 ring-2 ring-background" />}
                            {!active && count === undefined && sectionBadges.includes('dot') && <DotPastille className="absolute -right-1 -top-1 ring-2 ring-background" />}
                        </span>
                        <span className="max-w-full truncate">{section.label}</span>
                    </button>
                )
            })}
        </div>
    )
}

/** Le header dont le titre est la liste des onglets de la section : le second niveau n'ajoute pas de bande. */
export function SectionTabsHeader<T extends string>({
    current,
    tabId,
    badges,
    onSelect,
    onClose,
    actions,
}: {
    current: PanelSection<T>
    tabId: T
    badges: PanelSectionBadges<T>
    onSelect: (id: T) => void
    onClose: () => void
    actions?: ReactNode
}) {
    const t = useTranslations('agent.panelsShared')
    return (
        <div className="flex shrink-0 items-center gap-1 border-b border-border pl-3 pr-2">
            <div role="tablist" className="no-scrollbar flex min-w-0 flex-1 touch-pan-x items-stretch gap-4 overflow-x-auto">
                {current.tabs.map(tab => {
                    const active = tab.id === tabId
                    const badge = badges[tab.id]
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => onSelect(tab.id)}
                            className={cn(
                                'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-sm transition-colors',
                                active ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {tab.label}
                            {typeof badge === 'number' && <CountPastille count={badge} />}
                            {badge === 'dot' && <DotPastille />}
                        </button>
                    )
                })}
            </div>
            {actions}
            <Button aria-label={t('closePanel')} variant="ghost" size="icon-sm" onClick={onClose}>
                <XIcon className="size-4" />
            </Button>
        </div>
    )
}
