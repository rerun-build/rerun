'use client'

import { useState } from 'react'

import { SERVICE_CATEGORIES, type ServiceCategory } from '@rerun/contracts'

import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../forms/command'
import { Chip } from '../primitives/chip'
import { HScrollFade } from '../primitives/h-scroll-fade'
import { Skeleton } from '../primitives/skeleton'
import { useScrollFade } from '../primitives/use-scroll-fade'
import { CheckIcon } from '../icons'
import { MAX_APPS_AT_CREATION } from './reading'
import type { ConnectorCatalog } from './types'

import { AppLogo } from './marks'
import { useKitTranslations } from '../locale'

// The whole catalogue, searched by name and narrowed by category. What is ticked here is what the
// agent starts with: the apps read in the description come ticked, and unticking one keeps it off.
export function AppsPicker({ catalog, selected, onToggle }: { catalog: ConnectorCatalog | null; selected: string[]; onToggle: (slug: string) => void }) {
    const t = useKitTranslations()
    const [category, setCategory] = useState<ServiceCategory | null>(null)
    const [listEl, setListEl] = useState<HTMLDivElement | null>(null)
    const mask = useScrollFade(listEl)
    // Frozen when the picker opens: a row ticked while it is open keeps its place under the cursor.
    const [pinned] = useState(selected)
    if (!catalog) return <AppsPickerSkeleton />

    const catalogApps = [...catalog.values()]
    const apps = [...catalogApps.filter(app => pinned.includes(app.slug)), ...catalogApps.filter(app => !pinned.includes(app.slug))]
    const categories = SERVICE_CATEGORIES.filter(slug => slug !== 'other' && apps.some(app => app.category === slug))
    const full = selected.length >= MAX_APPS_AT_CREATION
    return (
        <Command className="p-0">
            <CommandInput placeholder={t('newAgent.appsPicker.search')} />
            {categories.length > 1 && (
                <div className="px-2 pt-2 pb-1">
                    <HScrollFade className="gap-1">
                        <Chip selected={category === null} onClick={() => setCategory(null)}>
                            {t('newAgent.appsPicker.all')}
                        </Chip>
                        {categories.map(slug => (
                            <Chip key={slug} selected={category === slug} onClick={() => setCategory(slug)}>
                                {t(`newAgent.appsPicker.categories.${slug}`)}
                            </Chip>
                        ))}
                    </HScrollFade>
                </div>
            )}
            <CommandList ref={setListEl} className="max-h-64 p-1" style={{ maskImage: mask, WebkitMaskImage: mask }}>
                <CommandEmpty>{t('newAgent.appsPicker.empty')}</CommandEmpty>
                {(category ? apps.filter(app => app.category === category) : apps).map(app => {
                    const ticked = selected.includes(app.slug)
                    return (
                        <CommandItem key={app.slug} value={app.name} keywords={[app.slug]} disabled={full && !ticked} onSelect={() => onToggle(app.slug)}>
                            <AppLogo app={app} />
                            <span className="min-w-0 flex-1 truncate">{app.name}</span>
                            {ticked && <CheckIcon className="size-4 text-foreground" />}
                        </CommandItem>
                    )
                })}
            </CommandList>
            {full && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t('newAgent.appsPicker.limit', { max: MAX_APPS_AT_CREATION })}</p>}
        </Command>
    )
}

function AppsPickerSkeleton() {
    return (
        <div className="flex flex-col gap-1 p-1">
            <Skeleton className="h-8 w-full rounded-lg" />
            {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex h-8 items-center gap-2 px-2">
                    <Skeleton className="size-4 rounded" />
                    <Skeleton className="h-3 w-28" />
                </div>
            ))}
        </div>
    )
}
