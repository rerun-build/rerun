'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { runPlanChange } from '@/ee/lib/billing/plan-payment'
import { MACHINE_SIZES, MACHINE_SPECS, MAX_STORAGE_PACKS, compareMachineSizes, machineDiskGib, type MachineSize } from '@/ee/lib/billing/plans'
import { useErrorText } from '@/hooks/useErrorText'
import { fitsOnDisk, type MachineReading } from '@rerun/contracts'

import { MachineSizeCards, StorageRow } from '../machine/MachinePicker'
import { PayFooter, SummaryRows, TermsConsent, UsdFlow, type SummaryRow } from '../parts'
import { usePlanQuote } from '../usePlanQuote'
import { billingDate, CardLine, Note, Panel } from './bits'
import type { PanelProps } from './views'

// The sizes and the storage a smaller machine could not take: what the machine holds today would
// fill its disk. Unknown while the machine never reported its disk.
export function tooFullFor(machine: MachineReading | null, size: MachineSize, packs: number): boolean {
    if (!machine) return false
    const diskGib = machineDiskGib(size, packs)
    return diskGib < machine.diskGib && !fitsOnDisk(machine.usedDiskGib, diskGib)
}

export function minPacksFor(machine: MachineReading | null, size: MachineSize, maxPacks: number): number {
    for (let packs = 0; packs < maxPacks; packs++) if (!tooFullFor(machine, size, packs)) return packs
    return maxPacks
}

// The size of the workspace's machine and its storage. A larger one is billed today for the rest of
// the period and the machine grows within minutes; a smaller one lands at the renewal, when the
// workspace moves to a fresh machine of that size.
export function MachinePanel({ state, go, onDone }: PanelProps) {
    const t = useTranslations('billing.machine')
    const tSize = useTranslations('billing.machine.sizes')
    const locale = useLocale()
    const errorText = useErrorText()
    const held = state.heldMachine
    const [size, setSize] = useState<MachineSize>(state.machineSize)
    const [packs, setPacks] = useState(state.quantities.storage_pack)
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const trial = state.status === 'trialing'
    const lockedReason = trial ? t('trialReason') : state.status === 'past_due' ? t('locked.pastDue') : state.cancelAtPeriodEnd ? t('locked.canceling') : undefined
    const renewal = state.periodEnd ? billingDate(state.periodEnd, locale) : t('yourRenewal')
    const machine = state.machine
    const usedGb = Math.ceil(machine?.usedDiskGib ?? 0)
    const unavailable = Object.fromEntries(MACHINE_SIZES.filter(each => tooFullFor(machine, each, packs)).map(each => [each, t('tooFull', { used: usedGb, size: machineDiskGib(each, packs) })]))
    const minPacks = minPacksFor(machine, size, MAX_STORAGE_PACKS)

    const selection = { quantities: { ...state.quantities, storage_pack: packs }, interval: state.interval, machineSize: size }
    const changed = size !== state.machineSize || packs !== state.quantities.storage_pack
    const quote = usePlanQuote(selection, changed && !lockedReason)
    const heldDisk = machineDiskGib(held.machineSize, held.storagePacks)
    const targetDisk = machineDiskGib(size, packs)
    const sizeChange = compareMachineSizes(size, held.machineSize)
    const grows = sizeChange > 0 || targetDisk > heldDisk
    const shrinks = sizeChange < 0 || targetDisk < heldDisk
    const pending = state.pendingDowngrade.machine_size !== undefined || state.pendingDowngrade.storage_packs !== undefined
    const resizing = !pending && !!machine && (machine.size !== held.machineSize || machine.diskGib < heldDisk)

    const apply = async (success: { title: string; body: string }) => {
        if (submitting) return
        setSubmitting(true)
        setError(null)
        const result = await runPlanChange(selection)
        setSubmitting(false)
        if (!result.ok) return setError(errorText(result))
        onDone(success)
    }

    const from = { size: tSize(held.machineSize), disk: heldDisk }
    const to = { size: tSize(size), disk: targetDisk }
    const specRows: SummaryRow[] = [
        { label: t('rows.storage'), value: t('rows.change', { from: heldDisk, to: targetDisk, unit: 'GB' }) },
        ...(sizeChange === 0
            ? []
            : [
                  { label: t('rows.memory'), value: t('rows.change', { from: MACHINE_SPECS[held.machineSize].memoryGib, to: MACHINE_SPECS[size].memoryGib, unit: 'GB' }) },
                  { label: t('rows.processor'), value: t('rows.change', { from: MACHINE_SPECS[held.machineSize].vcpus, to: MACHINE_SPECS[size].vcpus, unit: 'vCPU' }) },
              ]),
    ]

    const footer = (() => {
        if (!changed || lockedReason) return null
        if (quote === 'loading') return <Skeleton className="h-24 w-full rounded-xl" />
        // A preview that failed leaves the amount unsaid rather than the change unsold.
        if (grows) {
            const due = quote ? <UsdFlow cents={quote.dueTodayCents} /> : null
            return (
                <>
                    <SummaryRows rows={[...specRows, ...(due ? [{ label: t('rows.dueToday'), value: due, strong: true }] : [])]} />
                    <Note>{sizeChange > 0 ? t('notes.restart') : t('notes.diskLive')}</Note>
                    {shrinks && <Note>{t('notes.partLater', { date: renewal })}</Note>}
                    <CardLine card={state.card} />
                    <PayFooter
                        cta={due ? t.rich('cta.upgrade', { amount: () => due }) : t('cta.upgradePlain')}
                        onClick={() => void apply({ title: t('success.upTitle', to), body: t('success.upBody') })}
                        loading={submitting}
                        disabled={!accepted}
                        disabledReason={t('acceptTerms')}
                        error={error}
                    >
                        <TermsConsent checked={accepted} onChange={setAccepted} />
                    </PayFooter>
                </>
            )
        }
        if (!shrinks) {
            return <PayFooter cta={t('cta.keep', from)} footnote={t('nothingToday')} onClick={() => void apply({ title: t('success.keptTitle', from), body: t('success.keptBody') })} loading={submitting} error={error} />
        }
        return (
            <>
                <SummaryRows
                    rows={[
                        { label: t('rows.until', { date: renewal }), value: t('rows.machine', from) },
                        { label: t('rows.from', { date: renewal }), value: t('rows.machine', to), strong: true },
                    ]}
                />
                <Note>{t('notes.move', { date: renewal })}</Note>
                <PayFooter cta={t('cta.switchOn', { date: renewal })} footnote={t('nothingToday')} onClick={() => void apply({ title: t('success.downTitle', { ...to, date: renewal }), body: t('success.downBody') })} loading={submitting} error={error} />
            </>
        )
    })()

    return (
        <Panel>
            {trial && (
                <div className="flex flex-wrap items-center gap-3">
                    <Note>{t('trialReason')}</Note>
                    <Button size="sm" onClick={() => go('plan')}>
                        {t('startPro')}
                    </Button>
                </div>
            )}
            {pending && <Note>{t('notes.pending', { size: tSize(state.machineSize), disk: machineDiskGib(state.machineSize, state.quantities.storage_pack), date: renewal })}</Note>}
            {resizing && <Note>{t('notes.resizing')}</Note>}
            <MachineSizeCards current={held.machineSize} selected={size} interval={state.interval} onSelect={setSize} unavailable={unavailable} disabledReason={lockedReason} />
            <StorageRow packs={packs} onChange={setPacks} interval={state.interval} minPacks={minPacks} lessReason={t('tooFull', { used: usedGb, size: machineDiskGib(size, Math.max(0, packs - 1)) })} disabledReason={lockedReason} />
            {footer ?? (machine?.usedDiskGib != null && <Note>{t('notes.diskUsed', { used: usedGb, total: machine.diskGib })}</Note>)}
        </Panel>
    )
}
