'use client'

import { track } from '@rerun/analytics/client'
import { formatDate } from '@rerun/i18n/format'
import { isStoreProvider, type StoreProvider } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getSubscriptionStateAction } from '@/ee/actions/billing.actions'
import type { SubscriptionState } from '@/ee/services/billing.service'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { checkoutRouteFor, trialOffer, type CheckoutRoute } from '@/ee/lib/billing/checkout-variant'
import { CreditCardIcon, ExternalLinkIcon, RefreshCwIcon, Smartphone, TicketIcon } from '@/lib/icons'
import { isSubscriptionEntitled } from '@/ee/lib/billing/entitlement'
import { isLifetimePlan } from '@/ee/lib/billing/plans'
import { useBillingStore } from '@/stores/billing.store'
import { hasPendingStart, useOnboardingStore } from '@/stores/onboarding.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { useSession } from '@/supabase/session/SessionProvider'

import { BillingDialogShell } from './billing/BillingDialogShell'
import { CheckoutDialog } from './billing/CheckoutDialog'
import { PlanDialog } from './billing/PlanDialog'
import { CancelSubscriptionDialog } from './cancel-subscription/CancelSubscriptionDialog'

// What the dialog shows, decided when it opens and held until it closes: a payment rewrites the
// workspace through the webhook, and re-deciding then would swap the success panel for the next
// dialog under the user's eyes.
type Resolved = { kind: 'loading' } | { kind: 'checkout'; route: CheckoutRoute } | { kind: 'plan' } | { kind: 'lifetime' } | { kind: 'store'; provider: StoreProvider } | { kind: 'error' }

// Every openBilling() lands here. Two dialogs: the checkout, which sells a plan (or ends a trial),
// and the plan dialog, which manages one that is paid.
export function BillingDialog() {
    const { workspace, role } = useSession()
    const { open, highlightAddon, trigger, setOpen } = useBillingStore()
    const { access } = useWorkspaceAccess()
    const parked = useOnboardingStore(s => hasPendingStart(s))
    const [state, setState] = useState<SubscriptionState | null>(null)
    const [resolved, setResolved] = useState<Resolved>({ kind: 'loading' })
    const [cancelOpen, setCancelOpen] = useState(false)

    const entitled = isSubscriptionEntitled(workspace?.subscription_status)

    // `offer` is forced once the server refused a trial the browser thought was still there.
    const resolve = useCallback(
        (subscription: SubscriptionState | null, offer = trialOffer(workspace)) => {
            const route = checkoutRouteFor({
                status: workspace?.subscription_status,
                offer,
                paused: access === 'paused',
                hasPendingStart: parked,
                trigger,
                hasStripePlan: !!subscription,
                hasPaymentMethod: !!subscription?.hasPaymentMethod,
            })
            setResolved(route ? { kind: 'checkout', route } : { kind: 'plan' })
            return route
        },
        [workspace, access, parked, trigger],
    )

    // A failed read keeps the state already shown: dropping it would leave the plan dialog nothing
    // to draw but its skeleton.
    const loadState = useCallback(async () => {
        const result = await getSubscriptionStateAction()
        if (result.ok) setState(result.state)
        return result
    }, [])

    // An entitled workspace whose Stripe read failed is not one without a plan: deciding on nothing
    // would offer a paying customer to subscribe.
    const decide = useCallback(async () => {
        // Paid once, outside Stripe: there is nothing to sell, and a Pro subscription would overwrite
        // the plan, so cancelling it later would take the lifetime access away.
        if (isLifetimePlan(workspace)) {
            setResolved({ kind: 'lifetime' })
            track('paywall_viewed', { trigger: trigger ?? 'manual', addon_shown: highlightAddon ?? undefined, variant: 'lifetime' })
            return
        }
        // Bought in the mobile app, through its store: only the store can change or cancel it, and
        // a Stripe plan sold on top would bill the workspace twice.
        if (entitled && isStoreProvider(workspace?.billing_provider)) {
            setResolved({ kind: 'store', provider: workspace.billing_provider })
            track('paywall_viewed', { trigger: trigger ?? 'manual', addon_shown: highlightAddon ?? undefined, variant: 'store' })
            return
        }
        setResolved({ kind: 'loading' })
        const read = entitled ? await loadState() : null
        if (read && !read.ok) {
            setResolved({ kind: 'error' })
            return
        }
        const route = resolve(read?.state ?? null)
        track('paywall_viewed', { trigger: trigger ?? 'manual', addon_shown: highlightAddon ?? undefined, variant: route?.variant ?? 'plan' })
    }, [workspace, entitled, loadState, resolve, trigger, highlightAddon])

    const opened = useRef(false)
    useEffect(() => {
        if (!open) {
            opened.current = false
            return
        }
        if (opened.current || !workspace || role !== 'admin') return
        opened.current = true
        void decide()
    }, [open, workspace, role, decide])

    const reload = useCallback(async () => {
        await loadState()
    }, [loadState])

    const close = () => setOpen(false)

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {role === 'member' ? (
                <AdminOnlyShell onClose={close} />
            ) : resolved.kind === 'loading' ? (
                <LoadingShell />
            ) : resolved.kind === 'lifetime' ? (
                <LifetimeShell
                    onConnectAi={() => {
                        close()
                        useWorkspaceSettingsStore.getState().openAiProviders()
                    }}
                />
            ) : resolved.kind === 'store' && workspace ? (
                <StoreShell provider={resolved.provider} workspace={workspace} />
            ) : resolved.kind === 'error' ? (
                <ErrorShell onRetry={() => void decide()} />
            ) : resolved.kind === 'checkout' ? (
                <CheckoutDialog
                    key={`${resolved.route.variant}:${resolved.route.payment}`}
                    route={resolved.route}
                    state={state}
                    onClose={close}
                    onCancelTrial={() => setCancelOpen(true)}
                    onChanged={() => void reload()}
                    onTrialRefused={() => resolve(state, 'paid')}
                />
            ) : state ? (
                <PlanDialog state={state} highlightAddon={highlightAddon} onClose={close} onCancel={() => setCancelOpen(true)} onChanged={reload} />
            ) : (
                <LoadingShell />
            )}
            <CancelSubscriptionDialog open={cancelOpen} onOpenChange={setCancelOpen} onChanged={() => void reload()} />
        </Dialog>
    )
}

// Every upgrade, top-up and trial button of the app lands here, so a member is told once, in place,
// rather than refused by the server after a click.
function AdminOnlyShell({ onClose }: { onClose: () => void }) {
    const t = useTranslations('billing.dialog')
    return (
        <DialogContent aria-describedby={undefined} className="bg-popover sm:max-w-md">
            <DialogTitle className="sr-only">{t('title')}</DialogTitle>
            <EmptyState
                icon={CreditCardIcon}
                title={t('adminOnly.title')}
                description={t('adminOnly.description')}
                action={
                    <Button size="sm" variant="outline" onClick={onClose}>
                        {t('adminOnly.gotIt')}
                    </Button>
                }
            />
        </DialogContent>
    )
}

function LifetimeShell({ onConnectAi }: { onConnectAi: () => void }) {
    const t = useTranslations('billing.dialog')
    return (
        <DialogContent aria-describedby={undefined} className="bg-popover sm:max-w-md">
            <DialogTitle className="sr-only">{t('title')}</DialogTitle>
            <EmptyState
                icon={TicketIcon}
                title={t('lifetime.title')}
                description={t('lifetime.description')}
                action={
                    <Button size="sm" variant="outline" onClick={onConnectAi}>
                        {t('lifetime.connectAi')}
                    </Button>
                }
            />
        </DialogContent>
    )
}

// Where each store lets its subscriber change or cancel a subscription, from any browser.
const STORE_SUBSCRIPTIONS_URL: Record<StoreProvider, string> = {
    apple: 'https://apps.apple.com/account/subscriptions',
    google: 'https://play.google.com/store/account/subscriptions',
}

type StoreWorkspace = { subscription_status: string | null; trial_ends_at: string | null; current_period_end: string | null; subscription_cancel_at: string | null }

function StoreShell({ provider, workspace }: { provider: StoreProvider; workspace: StoreWorkspace }) {
    const t = useTranslations('billing.dialog')
    const locale = useLocale()
    const day = (iso: string) => formatDate(iso, locale, { month: 'long', day: 'numeric' })
    const status =
        workspace.subscription_status === 'past_due'
            ? t('store.pastDue')
            : workspace.subscription_cancel_at
              ? t('store.ending', { date: day(workspace.subscription_cancel_at) })
              : workspace.subscription_status === 'trialing' && workspace.trial_ends_at
                ? t('store.trialing', { date: day(workspace.trial_ends_at) })
                : workspace.current_period_end
                  ? t('store.active', { date: day(workspace.current_period_end) })
                  : null
    return (
        <DialogContent aria-describedby={undefined} className="bg-popover sm:max-w-md">
            <DialogTitle className="sr-only">{t('title')}</DialogTitle>
            <EmptyState
                icon={Smartphone}
                title={t('store.title', { store: provider })}
                description={status ?? undefined}
                action={
                    <Button size="sm" variant="outline" asChild>
                        <a href={STORE_SUBSCRIPTIONS_URL[provider]} target="_blank" rel="noreferrer">
                            {t('store.manage', { store: provider })} <ExternalLinkIcon className="size-3.5" />
                        </a>
                    </Button>
                }
            />
        </DialogContent>
    )
}

function ErrorShell({ onRetry }: { onRetry: () => void }) {
    const t = useTranslations('billing.dialog')
    return (
        <DialogContent aria-describedby={undefined} className="bg-popover sm:max-w-md">
            <DialogTitle className="sr-only">{t('title')}</DialogTitle>
            <EmptyState
                icon={CreditCardIcon}
                title={t('error.title')}
                description={t('error.description')}
                action={
                    <Button size="sm" variant="outline" onClick={onRetry}>
                        <RefreshCwIcon className="size-3.5" /> {t('error.retry')}
                    </Button>
                }
            />
        </DialogContent>
    )
}

function LoadingShell() {
    const t = useTranslations('billing.dialog')
    return (
        <BillingDialogShell
            title={t('title')}
            left={
                <div className="flex flex-col gap-4">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-10 w-64" />
                    <Skeleton className="h-4 w-80" />
                    <Skeleton className="mt-10 h-8 w-48" />
                    <Skeleton className="h-72 w-full rounded-2xl" />
                </div>
            }
            right={
                <div className="flex flex-1 flex-col gap-4">
                    <Skeleton className="h-12 w-48" />
                    <Skeleton className="h-40 w-full" />
                    <Skeleton className="mt-auto h-11 w-full" />
                </div>
            }
        />
    )
}
