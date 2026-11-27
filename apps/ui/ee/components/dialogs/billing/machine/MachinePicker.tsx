'use client'

import { BorderBeam } from '@rerun/ui'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { MACHINE_PRICES_CENTS, MACHINE_SIZES, MACHINE_SPECS, MAX_STORAGE_PACKS, PLAN_PRICES_CENTS, STORAGE_PACK_GIB, type BillingInterval, type MachineSize } from '@/ee/lib/billing/plans'
import { cn } from '@/lib/utils'

import { usd } from '../parts'
import { Stepper, TILE_FRAME } from '../tiles/bits'

// What a size costs a month on top of the plan, a yearly plan's brought back to one month.
function monthlyExtraCents(size: MachineSize, interval: BillingInterval): number {
    if (size === 'small') return 0
    return interval === 'yearly' ? Math.round(MACHINE_PRICES_CENTS.yearly[size] / 12) : MACHINE_PRICES_CENTS.monthly[size]
}

// The sizes side by side, or stacked with their figures on one line in a narrow column, the current
// one marked, the picked one lit: a size the machine cannot go
// down to (its data would not fit) stays visible, greyed, with the reason on hover.
export function MachineSizeCards({
    current,
    selected,
    interval,
    onSelect,
    unavailable,
    disabledReason,
}: {
    current: MachineSize
    selected: MachineSize
    interval: BillingInterval
    onSelect: (size: MachineSize) => void
    unavailable?: Partial<Record<MachineSize, string>>
    disabledReason?: string
}) {
    const t = useTranslations('billing.machine')
    const tSize = useTranslations('billing.machine.sizes')
    return (
        <div className="grid gap-2 @md:grid-cols-3">
            {MACHINE_SIZES.map(size => {
                const spec = MACHINE_SPECS[size]
                const extra = monthlyExtraCents(size, interval)
                const reason = disabledReason ?? unavailable?.[size]
                const picked = size === selected
                return (
                    <TooltipDisabledReason key={size} reason={reason} className="flex">
                        <button
                            type="button"
                            aria-pressed={picked}
                            disabled={!!reason}
                            onClick={() => onSelect(size)}
                            className={cn(
                                'relative flex w-full flex-col gap-2 rounded-xl p-4 text-start ring-1 ring-border transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                picked ? 'bg-brand/5' : 'enabled:hover:ring-foreground/20',
                            )}
                        >
                            {picked && <BorderBeam animated pattern="arcs" tone="brand" glow width={1} duration={7} />}
                            <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                                <span className="flex items-center gap-2">
                                    <span className="text-base font-medium">{tSize(size)}</span>
                                    {size === current && (
                                        <Badge size="sm" tone="green">
                                            {t('current')}
                                        </Badge>
                                    )}
                                </span>
                                <span className="text-sm tabular-nums @md:w-full">{extra ? t(interval === 'yearly' ? 'extraYearly' : 'extraMonthly', { amount: usd(extra) }) : t('included')}</span>
                            </span>
                            <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums @md:flex-col">
                                <span>{t('specs.disk', { gb: spec.diskGib })}</span>
                                <span>{t('specs.memory', { gb: spec.memoryGib })}</span>
                                <span>{t('specs.vcpus', { count: spec.vcpus })}</span>
                                <span>{t('specs.backups', { days: spec.shownBackupDays ?? 0 })}</span>
                            </span>
                        </button>
                    </TooltipDisabledReason>
                )
            })}
        </div>
    )
}

// Storage on top of any size, by packs of 50 GB. `minPacks` is what the data on the machine needs.
export function StorageRow({ packs, onChange, interval, minPacks = 0, lessReason, disabledReason }: { packs: number; onChange: (packs: number) => void; interval: BillingInterval; minPacks?: number; lessReason?: string; disabledReason?: string }) {
    const t = useTranslations('billing.machine.storage')
    const packCents = interval === 'yearly' ? Math.round(PLAN_PRICES_CENTS.yearly.storage_pack / 12) : PLAN_PRICES_CENTS.monthly.storage_pack
    return (
        <div className={cn('flex flex-wrap items-center gap-3 px-4 py-3', TILE_FRAME)}>
            <div className="min-w-0 flex-1 basis-48">
                <p className="text-sm font-medium">{t('title')}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{t('line', { gb: STORAGE_PACK_GIB, amount: usd(packCents) })}</p>
            </div>
            <TooltipDisabledReason reason={disabledReason}>
                <Stepper
                    value={packs}
                    min={disabledReason ? packs : minPacks}
                    max={disabledReason ? packs : MAX_STORAGE_PACKS}
                    onChange={onChange}
                    lessLabel={t('less')}
                    moreLabel={t('more')}
                    lessReason={disabledReason ? undefined : packs > 0 ? lessReason : undefined}
                    moreReason={disabledReason ? undefined : t('max', { count: MAX_STORAGE_PACKS })}
                />
            </TooltipDisabledReason>
        </div>
    )
}
