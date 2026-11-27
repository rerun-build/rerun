'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { BrandLogo } from '@/components/brand/BrandLogo'
import { useEnabledPaidApps } from '@/components/layout/FeatureFlagsProvider'
import { Button } from '@/components/ui/button'
import { arePaidAppsOffered, compareMachineSizes, LIFETIME_PLAN_SLUG, machineDiskGib } from '@/ee/lib/billing/plans'
import type { LifetimeBillingState } from '@/ee/services/lifetime-addons.service'
import { APP_SLUGS, type AppSlug } from '@/lib/apps/types'
import { CreditCardIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { BillingHighlight } from '@/stores/billing.store'
import { useSession } from '@/supabase/session/SessionProvider'

import { appSlotsOf, useAppSlots, type AppSlotsState } from '../AppsSection'
import { useCreditUsage } from '../credit-usage/useCreditUsage'
import { useInvoices } from '../InvoicesPane'
import { SuccessPanel } from '../parts'
import { usePageHeader } from './BillingTilesDialog'
import { billingDate, TILE_FRAME } from './bits'
import { CreditsPanel, UsagePanel } from './CreditsPanels'
import { AppsTile, CreditsTile, MachineTile } from './Home'
import { LifetimeAppsPanel } from './LifetimeAppsPanel'
import { LifetimeMachinePanel, lifetimePaidMachine } from './LifetimeMachinePanel'
import { BusinessPanel, InvoiceRows, InvoicesPanel } from './PaymentPanels'
import { TilesFrame } from './TilesFrame'
import type { Success, TilesData } from './views'

type LifetimeView = 'home' | 'credits' | 'usage' | 'machine' | 'apps' | 'business' | 'invoices'

const PARENT: Partial<Record<LifetimeView, LifetimeView>> = { usage: 'credits' }

const HISTORY_ROWS = 4

// A lifetime deal has no plan to be late on or to cancel: its pages read as a plan in good standing,
// with no card on file.
const PLAN_FACTS = { status: 'active', cancelAtPeriodEnd: false, card: null } as const

type LifetimeData = Pick<TilesData, 'credit' | 'invoices' | 'apps' | 'appSlots'>

// The billing of a workspace that paid once: the same tiles as a plan, the lifetime deal in place of
// the plan, then the Rerun credit, the machine and the apps, which are billed apart from it.
// `appSlots` stands in for the fetched accounts, for the lab only.
export function LifetimeTilesDialog({
    state,
    highlightAddon,
    onChanged,
    onConnectAi,
    appSlots,
}: {
    state: LifetimeBillingState
    highlightAddon: BillingHighlight | null
    onChanged: () => Promise<void>
    onConnectAi: () => void
    appSlots?: Partial<Record<AppSlug, AppSlotsState>>
}) {
    const t = useTranslations('billing')
    const tPages = useTranslations('billing.tiles.pages')
    const { workspace, refreshWorkspace } = useSession()
    // Sizes are sold to the full lifetime plan, on the subscription of its app slots.
    const machineOffered = workspace?.plan === LIFETIME_PLAN_SLUG && arePaidAppsOffered(workspace)
    const [view, setView] = useState<LifetimeView>(highlightAddon === 'credit_pack' ? 'credits' : machineOffered && (highlightAddon === 'machine' || highlightAddon === 'storage_pack') ? 'machine' : 'home')
    const [success, setSuccess] = useState<Success | null>(null)
    const [reloads, setReloads] = useState(0)

    const enabledApps = useEnabledPaidApps()
    const currentSlots = appSlotsOf(state.quantities)
    const apps = arePaidAppsOffered(workspace) ? APP_SLUGS.filter(slug => enabledApps.includes(slug) || currentSlots[slug] > 0) : []
    const fetchedSlots = useAppSlots(apps, !!appSlots)
    const data: LifetimeData = {
        // A lifetime deal comes with no monthly credit: what it holds is bought, and never resets.
        credit: { ...useCreditUsage(), resetsOn: null },
        invoices: useInvoices(reloads),
        apps,
        appSlots: appSlots ?? fetchedSlots,
    }

    const back = () => setView(PARENT[view] ?? 'home')
    const done = async (next: Success) => {
        await refreshWorkspace()
        await onChanged()
        setReloads(count => count + 1)
        setSuccess(next)
    }

    const pageHeader = usePageHeader(view === 'home' ? 'credits' : view, PLAN_FACTS)
    const stepKey = success ? 'success' : view
    const onPage = !success && view !== 'home'
    const depth = (view === 'home' ? 0 : PARENT[view] ? 2 : 1) + (success ? 1 : 0)
    const header = onPage ? { ...pageHeader, key: stepKey, onBack: back } : { icon: CreditCardIcon, title: tPages('home.title'), description: t('lifetime.overview.deal'), key: stepKey }

    const body = success ? (
        <SuccessPanel
            title={success.title}
            body={success.body}
            rows={success.rows}
            cta={t('plan.success.done')}
            onDone={() => {
                setSuccess(null)
                setView('home')
            }}
        />
    ) : view === 'credits' ? (
        <CreditsPanel state={PLAN_FACTS} data={data} go={next => next === 'usage' && setView('usage')} onDone={done} />
    ) : view === 'usage' ? (
        <UsagePanel data={data} />
    ) : view === 'machine' ? (
        <LifetimeMachinePanel state={state} onDone={done} />
    ) : view === 'apps' ? (
        <LifetimeAppsPanel state={state} data={data} onDone={done} onFailed={onChanged} />
    ) : view === 'business' ? (
        <BusinessPanel state={state} onDone={done} />
    ) : view === 'invoices' ? (
        <InvoicesPanel state={PLAN_FACTS} data={data} />
    ) : (
        <LifetimeHome state={state} data={data} machineOffered={machineOffered} go={setView} onConnectAi={onConnectAi} />
    )

    return (
        <TilesFrame header={header} stepKey={stepKey} depth={depth}>
            {body}
        </TilesFrame>
    )
}

function LifetimeHome({ state, data, machineOffered, go, onConnectAi }: { state: LifetimeBillingState; data: LifetimeData; machineOffered: boolean; go: (view: LifetimeView) => void; onConnectAi: () => void }) {
    const t = useTranslations('billing')
    const tHome = useTranslations('billing.tiles.home')
    const tPages = useTranslations('billing.tiles.pages')
    const tMachine = useTranslations('billing.machine')
    const locale = useLocale()
    const link = 'underline-offset-4 hover:text-foreground hover:underline'

    const held = state.heldMachine
    const paid = lifetimePaidMachine(state)
    const shrinks = compareMachineSizes(paid.machineSize, held.machineSize) < 0 || machineDiskGib(paid.machineSize, paid.storagePacks) < machineDiskGib(held.machineSize, held.storagePacks)

    return (
        <div className="flex flex-col gap-4">
            <div className={cn('flex flex-wrap items-center gap-3 p-4', TILE_FRAME)}>
                <BrandLogo size="md" />
                <div className="min-w-0 flex-1">
                    <p className="font-medium">{t('lifetime.title')}</p>
                    <p className="text-sm text-muted-foreground">{t('lifetime.subtitle')}</p>
                </div>
                <Button size="sm" variant="outline" onClick={onConnectAi}>
                    {t('lifetime.overview.aiProviders')}
                </Button>
            </div>

            <div className="grid gap-3 @lg:grid-cols-2">
                <CreditsTile state={PLAN_FACTS} data={data} go={go} />
                {machineOffered && (
                    <MachineTile
                        held={held}
                        machine={state.machine}
                        pending={shrinks && state.periodEnd ? { size: paid.machineSize, date: billingDate(state.periodEnd, locale) } : null}
                        lockedReason={state.trialing ? tMachine('lifetimeTrialReason') : undefined}
                        onChange={() => go('machine')}
                    />
                )}
                {data.apps.length > 0 && <AppsTile state={{ status: state.trialing ? 'trialing' : 'active', quantities: state.quantities, interval: 'monthly' }} data={data} go={go} />}
            </div>

            {state.hasCustomer && (
                <>
                    <div className="flex items-center justify-between gap-3 pt-1">
                        <p className="text-sm font-medium">{tHome('history')}</p>
                        <Button size="xs" variant="ghost" onClick={() => go('invoices')}>
                            {tHome('allInvoices')}
                        </Button>
                    </div>
                    {data.invoices && data.invoices.length === 0 ? <p className="text-sm text-muted-foreground">{tHome('noInvoice')}</p> : <InvoiceRows invoices={data.invoices} limit={HISTORY_ROWS} />}
                    <div className="flex justify-center pt-1 text-xs text-muted-foreground">
                        <button type="button" onClick={() => go('business')} className={link}>
                            {tPages('business.title')}
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}
