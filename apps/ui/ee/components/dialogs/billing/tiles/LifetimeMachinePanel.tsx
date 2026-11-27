'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { runLifetimeMachineChange } from '@/ee/lib/billing/plan-payment'
import { INCLUDED_MACHINE_SIZE, MACHINE_SIZES, MAX_STORAGE_PACKS, PLAN_PRICES_CENTS, compareMachineSizes, machineDiskGib, machinePriceCents, type MachineSize } from '@/ee/lib/billing/plans'
import type { LifetimeBillingState } from '@/ee/services/lifetime-addons.service'
import { useErrorText } from '@/hooks/useErrorText'

import { MachineSizeCards, StorageRow } from '../machine/MachinePicker'
import { PayFooter, SummaryRows, TermsConsent, usd } from '../parts'
import { billingDate, Note, Panel } from './bits'
import { minPacksFor, tooFullFor } from './MachinePanel'
import type { Success } from './views'

function monthlyCents(size: MachineSize, packs: number): number {
    return machinePriceCents(size, 'monthly') + packs * PLAN_PRICES_CENTS.monthly.storage_pack
}

// What the add-ons subscription pays for from its next renewal. Set to end, it still carries what was
// given back, and pays for nothing.
export function lifetimePaidMachine(state: Pick<LifetimeBillingState, 'cancelAtPeriodEnd' | 'machineSize' | 'quantities'>): LifetimeBillingState['heldMachine'] {
    return state.cancelAtPeriodEnd ? { machineSize: INCLUDED_MACHINE_SIZE, storagePacks: 0 } : { machineSize: state.machineSize, storagePacks: state.quantities.storage_pack }
}

// The machine of a full lifetime workspace, billed by the month on the subscription of its app slots:
// the first purchase through Stripe's Checkout, a larger size billed today for the rest of the month,
// a smaller one at the renewal, when the workspace moves to a fresh machine of that size.
export function LifetimeMachinePanel({ state, onDone }: { state: LifetimeBillingState; onDone: (success: Success) => void | Promise<void> }) {
    const t = useTranslations('billing.machine')
    const tSize = useTranslations('billing.machine.sizes')
    const locale = useLocale()
    const errorText = useErrorText()
    const held = state.heldMachine
    const paid = lifetimePaidMachine(state)
    const [size, setSize] = useState<MachineSize>(paid.machineSize)
    const [packs, setPacks] = useState(paid.storagePacks)
    const [accepted, setAccepted] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const renewal = state.periodEnd ? billingDate(state.periodEnd, locale) : t('yourRenewal')
    const lockedReason = state.trialing ? t('lifetimeTrialReason') : undefined
    const machine = state.machine
    const usedGb = Math.ceil(machine?.usedDiskGib ?? 0)
    const unavailable = Object.fromEntries(MACHINE_SIZES.filter(each => tooFullFor(machine, each, packs)).map(each => [each, t('tooFull', { used: usedGb, size: machineDiskGib(each, packs) })]))
    const changed = size !== paid.machineSize || packs !== paid.storagePacks
    const heldDisk = machineDiskGib(held.machineSize, held.storagePacks)
    const paidDisk = machineDiskGib(paid.machineSize, paid.storagePacks)
    const pending = compareMachineSizes(paid.machineSize, held.machineSize) < 0 || paidDisk < heldDisk
    const targetDisk = machineDiskGib(size, packs)
    const sizeChange = compareMachineSizes(size, held.machineSize)
    const grows = sizeChange > 0 || targetDisk > heldDisk
    const shrinks = sizeChange < 0 || targetDisk < heldDisk
    const checkout = !!state.slotsCheckout
    const monthly = monthlyCents(size, packs)
    const from = { size: tSize(held.machineSize), disk: heldDisk }
    const to = { size: tSize(size), disk: targetDisk }

    const apply = async (success: { title: string; body: string }) => {
        if (submitting) return
        setSubmitting(true)
        setError(null)
        const result = await runLifetimeMachineChange({ machineSize: size, storagePacks: packs })
        if (!result.ok) {
            setSubmitting(false)
            return setError(errorText(result))
        }
        // Stripe's Checkout has the page from here.
        if (result.checkoutUrl) return
        setSubmitting(false)
        void onDone(success)
    }

    const footer = (() => {
        if (!changed || lockedReason) return null
        if (grows) {
            return (
                <>
                    <SummaryRows
                        rows={[
                            { label: t('rows.storage'), value: t('rows.change', { from: heldDisk, to: targetDisk, unit: 'GB' }) },
                            { label: t('rows.monthly'), value: t('rows.perMonth', { amount: usd(monthly) }), strong: true },
                        ]}
                    />
                    <Note>{checkout ? t('notes.lifetimeCheckout') : t('notes.lifetimeProrated')}</Note>
                    {shrinks && <Note>{t('notes.partLater', { date: renewal })}</Note>}
                    <PayFooter
                        cta={checkout ? t('cta.subscribe', { amount: usd(monthly) }) : t('cta.upgradePlain')}
                        onClick={() => void apply({ title: t('success.upTitle', to), body: t('success.upBody') })}
                        loading={submitting}
                        disabled={!checkout && !accepted}
                        disabledReason={t('acceptTerms')}
                        error={error}
                    >
                        {!checkout && <TermsConsent checked={accepted} onChange={setAccepted} />}
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
            {lockedReason && <Note>{lockedReason}</Note>}
            {pending && <Note>{t('notes.pending', { size: tSize(paid.machineSize), disk: paidDisk, date: renewal })}</Note>}
            <MachineSizeCards current={held.machineSize} selected={size} interval="monthly" onSelect={setSize} unavailable={unavailable} disabledReason={lockedReason} />
            <StorageRow
                packs={packs}
                onChange={setPacks}
                interval="monthly"
                minPacks={minPacksFor(machine, size, MAX_STORAGE_PACKS)}
                lessReason={t('tooFull', { used: usedGb, size: machineDiskGib(size, Math.max(0, packs - 1)) })}
                disabledReason={lockedReason}
            />
            {footer ?? (machine?.usedDiskGib != null && <Note>{t('notes.diskUsed', { used: usedGb, total: machine.diskGib })}</Note>)}
        </Panel>
    )
}
