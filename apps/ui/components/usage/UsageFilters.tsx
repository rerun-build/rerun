'use client'

import { useTranslations } from 'next-intl'
import { useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { FilterSelect, type FilterOption } from '@/components/ui/filter-select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarIcon, CheckIcon, ChevronDownIcon, DownloadIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { PERIOD_PRESETS, presetPeriod, rangePeriod, type Dimension, type FilterValues, type Period, type PeriodPreset, type Pricing } from './usage-model'
import type { UsageFormat } from './usage-directory'

export type UsageFilters = { preset: PeriodPreset | null; custom: Period | null; values: FilterValues }

export type FilterOptions = Record<Dimension, FilterOption[]>

export function useUsageFilters(initial: PeriodPreset = '30d') {
    const [filters, setFilters] = useState<UsageFilters>({ preset: initial, custom: null, values: { coworkers: [], starters: [], models: [], pricing: [] } })
    const setValues = (dimension: Dimension, values: string[]) => setFilters(prev => ({ ...prev, values: { ...prev.values, [dimension]: values } }))
    const toggle = (dimension: Dimension, value: string) =>
        setFilters(prev => {
            const values = prev.values[dimension]
            return { ...prev, values: { ...prev.values, [dimension]: values.includes(value) ? values.filter(v => v !== value) : [...values, value] } }
        })
    const clear = () => setFilters(prev => ({ ...prev, values: { coworkers: [], starters: [], models: [], pricing: [] } }))
    const setPeriod = (period: Period) => setFilters(prev => ({ ...prev, preset: period.preset, custom: period.preset ? null : period }))
    const activeCount = Object.values(filters.values).reduce((sum, values) => sum + values.length, 0)
    return { filters, setValues, toggle, clear, setPeriod, activeCount }
}

export type FiltersApi = ReturnType<typeof useUsageFilters>

// A preset follows the clock, so a live run that starts now still falls inside "Today". So does a
// range of the calendar that ends today: it stops at now, not at the hour it was picked.
export function periodOf(filters: UsageFilters, now: number): Period {
    if (filters.preset || !filters.custom) return presetPeriod(filters.preset ?? '30d', now)
    return { ...filters.custom, to: Math.min(filters.custom.to, now) }
}

function PeriodPicker({ period, now, earliest, format, onChange }: { period: Period; now: number; earliest: number; format: UsageFormat; onChange: (period: Period) => void }) {
    const t = useTranslations('usage.period')
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState<{ from?: Date; to?: Date } | undefined>(undefined)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const [container, setContainer] = useState<HTMLElement | null>(null)
    const label = period.preset ? t(period.preset) : t('range', { from: format.day(period.from), to: format.day(period.to) })

    return (
        <Popover
            open={open}
            onOpenChange={next => {
                if (next) {
                    setContainer(triggerRef.current?.closest<HTMLElement>('[data-slot="dialog-content"]') ?? null)
                    setDraft({ from: new Date(period.from), to: new Date(period.to) })
                }
                setOpen(next)
            }}
        >
            <PopoverTrigger asChild>
                <button ref={triggerRef} type="button" className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground transition-colors hover:bg-muted/50">
                    <CalendarIcon className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate text-start">{label}</span>
                    <ChevronDownIcon className={cn('size-4 opacity-50 transition-transform', open && 'rotate-180')} />
                </button>
            </PopoverTrigger>
            <PopoverContent container={container} align="start" className="w-auto max-w-[calc(100vw-1rem)] p-0">
                <div className="flex max-sm:flex-col">
                    <ul className="flex shrink-0 flex-col gap-0.5 border-border p-2 max-sm:flex-row max-sm:flex-wrap max-sm:border-b sm:w-40 sm:border-e">
                        {PERIOD_PRESETS.map(preset => (
                            <li key={preset}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onChange(presetPeriod(preset, now))
                                        setOpen(false)
                                    }}
                                    className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted', period.preset === preset && 'font-medium text-foreground')}
                                >
                                    {t(preset)}
                                    {period.preset === preset && <CheckIcon className="size-3.5 max-sm:hidden" />}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="flex flex-col gap-2 p-2">
                        <Calendar
                            mode="range"
                            numberOfMonths={1}
                            selected={draft as never}
                            onSelect={(range: { from?: Date; to?: Date } | undefined) => setDraft(range)}
                            startMonth={new Date(earliest)}
                            endMonth={new Date(now)}
                            disabled={{ after: new Date(now) }}
                            defaultMonth={new Date(period.to)}
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                                {t('cancel')}
                            </Button>
                            <Button
                                size="sm"
                                disabled={!draft?.from}
                                onClick={() => {
                                    if (!draft?.from) return
                                    onChange(rangePeriod(draft.from, draft.to ?? draft.from))
                                    setOpen(false)
                                }}
                            >
                                {t('apply')}
                            </Button>
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}

function Chip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove: () => void; removeLabel: string }) {
    return (
        <span className="flex h-7 items-center gap-1.5 rounded-full bg-muted py-0.5 ps-1 pe-1 text-xs">
            {children}
            <button type="button" onClick={onRemove} aria-label={removeLabel} className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground">
                <XIcon className="size-3" />
            </button>
        </span>
    )
}

const DIMENSIONS: Dimension[] = ['coworkers', 'starters', 'models', 'pricing']

// The bar of a provider's usage page: the period, one menu per dimension, then the export. The
// filters in effect read back as chips under it, each with its own way out.
export function FilterBar({ api, period, now, earliest, options, shown, total, format, onExport }: { api: FiltersApi; period: Period; now: number; earliest: number; options: FilterOptions; shown: number; total: number; format: UsageFormat; onExport: () => void }) {
    const t = useTranslations('usage.filters')
    const { filters, setValues, toggle, clear, setPeriod, activeCount } = api
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <PeriodPicker period={period} now={now} earliest={earliest} format={format} onChange={setPeriod} />
                {DIMENSIONS.map(dimension => (
                    <FilterSelect key={dimension} label={t(dimension)} options={options[dimension]} values={filters.values[dimension]} onChange={values => setValues(dimension, dimension === 'pricing' ? (values as Pricing[]) : values)} />
                ))}
                <Button variant="outline" size="sm" className="ms-auto h-9" onClick={onExport} disabled={shown === 0}>
                    <DownloadIcon className="size-3.5" />
                    <span className="max-sm:sr-only">{t('export')}</span>
                </Button>
            </div>
            {activeCount > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {DIMENSIONS.flatMap(dimension =>
                        filters.values[dimension].map(value => {
                            const option = options[dimension].find(o => o.value === value)
                            return (
                                <Chip key={`${dimension}-${value}`} onRemove={() => toggle(dimension, value)} removeLabel={t('remove')}>
                                    {option?.icon ?? <span className="ps-1.5" />}
                                    <span className="max-w-32 truncate">{option?.label ?? value}</span>
                                </Chip>
                            )
                        })
                    )}
                    <Button variant="ghost" size="sm" onClick={clear}>
                        {t('clearAll')}
                    </Button>
                    <span className="ms-auto text-xs text-muted-foreground tabular-nums">{t('shown', { shown, total, shownText: format.count(shown), totalText: format.count(total) })}</span>
                </div>
            )}
        </div>
    )
}
