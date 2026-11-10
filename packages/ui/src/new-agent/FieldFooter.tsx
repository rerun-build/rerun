'use client'

import type { ComponentProps } from 'react'

import { Button } from '../primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '../forms/popover'
import { useDialogPortalContainer } from '../forms/use-dialog-portal-container'
import { ArrowRightIcon, ChevronDownIcon, ClockIcon, PlusIcon } from '../icons'
import type { JobSchedule } from './reading'
import { type ScheduleChoice, scheduleLabel } from './schedule'
import type { ConnectorCatalog } from './types'
import type { CatalogEntry } from './types'
import { cn } from '../cn'
import { useKitTranslations, useUiLocale } from '../locale'

import { AppsPicker } from './AppsPicker'
import { AppLogo } from './marks'
import { NamePill } from './NamePill'
import { SchedulePlanner } from './SchedulePlanner'

export type FieldFooterProps = {
    name: string | null
    nameProps: Omit<ComponentProps<typeof NamePill>, 'name'>
    catalog: ConnectorCatalog | null
    apps: string[]
    onToggleApp: (slug: string) => void
    schedule: { read: JobSchedule | null; choice: ScheduleChoice; onChoice: (choice: ScheduleChoice) => void; open: boolean; onOpenChange: (open: boolean) => void }
    canCreate: boolean
    creating: boolean
}

// The field's footer: the name, the apps read in the description (or "+ Apps") with their picker,
// the timing it read (or "Schedule") with its planner, and the create button, which submits the
// form the field sits in.
export function FieldFooter({ name, nameProps, catalog, apps, onToggleApp, schedule, canCreate, creating }: FieldFooterProps) {
    const t = useKitTranslations()
    const locale = useUiLocale()
    const shown = apps.flatMap(slug => catalog?.get(slug) ?? [])
    const scheduled = scheduleLabel(schedule.choice, t, locale) ?? schedule.read?.label ?? null
    const [rowRef, portalContainer] = useDialogPortalContainer<HTMLDivElement>()
    return (
        <div ref={rowRef} className="@container relative flex items-center gap-1">
            <NamePill name={name} {...nameProps} />
            <Popover>
                <PopoverTrigger asChild>{shown.length > 0 ? <PickedApps apps={shown} /> : <AddApps />}</PopoverTrigger>
                <PopoverContent container={portalContainer} align="start" sideOffset={8} className="w-72 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0">
                    <AppsPicker catalog={catalog} selected={apps} onToggle={onToggleApp} />
                </PopoverContent>
            </Popover>
            <Popover open={schedule.open} onOpenChange={schedule.onOpenChange}>
                <PopoverTrigger asChild>
                    <ScheduleButton label={scheduled} />
                </PopoverTrigger>
                {/* Focus stays on the button: landing on the first row would ring an option nobody chose. */}
                <PopoverContent container={portalContainer} align="start" sideOffset={8} onOpenAutoFocus={event => event.preventDefault()} className="w-[356px] max-w-[calc(100vw-2rem)] gap-0 rounded-xl p-1.5">
                    <SchedulePlanner read={schedule.read} app={shown[0]} choice={schedule.choice} onChoice={schedule.onChoice} />
                </PopoverContent>
            </Popover>
            {/* The only part of the row that gives way: a long name is cut in the button, where the pill
                and the title already spell it out, rather than pushing the button to a line of its own.
                Where the row is too narrow for the sentence at all, on a phone, the button is its arrow
                and the pill and the timing are the ones that give way. */}
            <Button type="submit" data-aim="create" disabled={!canCreate || creating} className="ml-auto max-w-full min-w-0 shrink @max-[24rem]:w-8 @max-[24rem]:shrink-0 @max-[24rem]:px-0">
                <span className="truncate @max-[24rem]:sr-only">{name ? t('newAgent.create', { name }) : t('newAgent.createCoworker')}</span>
                <ArrowRightIcon className="size-3.5" />
            </Button>
        </div>
    )
}

function AddApps(props: ComponentProps<typeof Button>) {
    const t = useKitTranslations()
    return (
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" {...props}>
            <PlusIcon />
            {t('newAgent.apps')}
        </Button>
    )
}

// A footer button that holds something lights up as a whole: the border is the one every button
// already carries, transparent until now, so nothing moves by a pixel.
const ACTIVE_CHIP = 'border-border bg-muted/60 hover:bg-muted dark:bg-muted/40 dark:hover:bg-muted/60'

// The apps the agent starts with take the place of "+ Apps", bare logos in one lit button, which
// still opens the picker.
function PickedApps({ apps, ...props }: ComponentProps<typeof Button> & { apps: CatalogEntry[] }) {
    const t = useKitTranslations()
    return (
        <Button type="button" variant="ghost" size="sm" aria-label={t('newAgent.pickedApps', { apps: apps.map(app => app.name).join(', ') })} className={cn('gap-1.5 px-2 text-muted-foreground', ACTIVE_CHIP)} {...props}>
            {apps.map(app => (
                <AppLogo key={app.slug} app={app} className="animate-in fade-in-0 zoom-in-75 duration-300" />
            ))}
        </Button>
    )
}

// Empty, a clock and "Schedule". Once the description says when the job runs, or the planner does,
// the button says it back, a shade brighter, with the chevron that tells it can be changed.
function ScheduleButton({ label, className, ...props }: ComponentProps<typeof Button> & { label: string | null }) {
    const t = useKitTranslations()
    return (
        <Button type="button" variant="ghost" size="sm" className={cn(label ? ['text-foreground/85 @max-[24rem]:min-w-0 @max-[24rem]:shrink', ACTIVE_CHIP] : 'text-muted-foreground @max-[30rem]:px-1.5', className)} {...props}>
            <ClockIcon />
            <span className={cn('max-w-44 truncate', !label && '@max-[30rem]:sr-only')}>{label ?? t('newAgent.schedule.button')}</span>
            {label && <ChevronDownIcon className="size-3 opacity-50" />}
        </Button>
    )
}
