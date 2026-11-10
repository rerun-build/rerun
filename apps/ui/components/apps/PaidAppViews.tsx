'use client'

import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { TRIAL_DAYS, formatAmount } from '@rerun/contracts'
import { formatDate } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { BorderBeam } from '@rerun/ui'
import { Badge } from '@rerun/ui/primitives'
import type { AppConnectionView, AppsOverview } from '@/app/api/_services/apps.service'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipDisabledReason, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useCatalogServices } from '@/hooks/useCatalogServices'
import { useIsWorkspaceAdmin } from '@/supabase/session/SessionProvider'
import { appInfo } from '@/lib/apps/catalog'
import type { AppSlug } from '@/lib/apps/types'
import { ArrowRightIcon, CheckIcon, ChevronLeftIcon, LogOutIcon, PlusIcon, UsersIcon } from '@/lib/icons'
import { serviceIconProps } from '@/lib/services/icons'
import { cn } from '@/lib/utils'
import { AppRerunLink } from './AppRerunLink'

// The screens every paid app shares in its dialog: what it does before the first account, the
// accounts and slots, the drilled-in page header, the success. Each app adds its own sign-in.

// What an app says about itself on its intro screen.
export type AppPresentation = {
    slug: AppSlug
    capabilities: { icon: ComponentType<{ className?: string }>; key: AppCapability }[]
}

type AppsTranslator = ReturnType<typeof useTranslations<'apps'>>

export type AppCapability = 'linkedinMessages' | 'linkedinSearch' | 'linkedinReplies' | 'whatsappReplies' | 'whatsappMessages' | 'whatsappCareful'

function slotPriceLabel(t: AppsTranslator, overview: Pick<AppsOverview, 'slotPriceCents' | 'interval'>): string {
    return t(overview.interval === 'yearly' ? 'slotPrice.yearly' : 'slotPrice.monthly', { price: formatAmount(overview.slotPriceCents, 'usd') })
}

// The app's logo from the services catalog, drawn like every other app of the library. The plain
// provider row lends its logo while the app's own row has none.
export function AppIcon({ slug, size = 'sm', tone }: { slug: AppSlug; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; tone?: ComponentProps<typeof Icon>['tone'] }) {
    const { serviceSlug, brandSlug } = appInfo(slug)
    const { resolved } = useCatalogServices([serviceSlug, brandSlug])
    const icon = resolved.get(serviceSlug)?.icon ?? resolved.get(brandSlug)?.icon ?? null
    return <Icon size={size} tone={tone} {...(icon ? serviceIconProps(icon) : { icon: UsersIcon })} />
}

function shortDate(iso: string, locale: string) {
    return formatDate(iso, locale, { month: 'long', day: 'numeric' })
}

function slotTotal(overview: AppsOverview): number {
    return Math.max(overview.stripeSlots + (overview.subscriberTrialEndsAt ? 1 : 0), overview.connections.length)
}

// Why nothing new can be connected right now, if so.
function blockedReason(t: AppsTranslator, overview: AppsOverview): string | undefined {
    if (!overview.subscribed) return t('blocked.notSubscribed')
    if (overview.paused) return t('blocked.paused')
    if (overview.allowance === 'buy_slot' && overview.workspaceTrialing) return t('blocked.trialSlot', { provider: appInfo(overview.slug).providerLabel })
    return undefined
}

function slotsDescription(t: AppsTranslator, overview: AppsOverview, locale: string): string {
    if (overview.subscriberTrialEndsAt) return t('slots.subscriberTrial', { date: shortDate(overview.subscriberTrialEndsAt, locale), price: slotPriceLabel(t, overview) })
    if (overview.workspaceTrialing && overview.stripeSlots > 0) return t('slots.workspaceTrial')
    return t('slots.paid', { price: slotPriceLabel(t, overview) })
}

function offer(t: AppsTranslator, overview: AppsOverview): { headline: string; detail: string } {
    const price = slotPriceLabel(t, overview)
    if (overview.allowance === 'subscriber_trial') return { headline: t('offer.subscriberTrial.headline', { days: TRIAL_DAYS }), detail: t('offer.subscriberTrial.detail', { price }) }
    if (overview.allowance === 'workspace_trial_slot') return { headline: t('offer.workspaceTrial.headline'), detail: t('offer.workspaceTrial.detail', { price }) }
    if (overview.allowance === 'free_slot') return { headline: t('offer.freeSlot.headline'), detail: t('offer.freeSlot.detail') }
    return { headline: t('offer.buySlot.headline', { price }), detail: t('offer.buySlot.detail') }
}

// Returned as an element rather than a string so its callers, which only render it, get it in the
// viewer's language without having to hold a translator themselves.
export function connectHint(overview: AppsOverview | null, reconnectLabel: string | null | undefined): ReactNode {
    return <ConnectHint overview={overview} reconnectLabel={reconnectLabel} />
}

function ConnectHint({ overview, reconnectLabel }: { overview: AppsOverview | null; reconnectLabel: string | null | undefined }) {
    const t = useTranslations('apps')
    if (reconnectLabel) return t('connectHint.reconnect', { label: reconnectLabel })
    if (overview?.allowance === 'subscriber_trial') return t('connectHint.subscriberTrial', { days: TRIAL_DAYS, price: slotPriceLabel(t, overview) })
    if (overview?.allowance === 'workspace_trial_slot') return t('connectHint.workspaceTrial', { price: slotPriceLabel(t, overview) })
    return t('connectHint.default')
}

function AddSlotConfirm({ overview, pending, onAddSlot, children }: { overview: AppsOverview; pending: boolean; onAddSlot: () => void; children: ReactNode }) {
    const t = useTranslations('apps')
    return (
        <ConfirmDialog
            title={t('addSlot.title', { provider: appInfo(overview.slug).providerLabel })}
            description={t('addSlot.description', { price: slotPriceLabel(t, overview) })}
            confirmLabel={t('addSlot.confirm')}
            confirmVariant="default"
            pending={pending}
            onConfirm={onAddSlot}
        >
            {children}
        </ConfirmDialog>
    )
}

type IntroScreenProps = {
    presentation: AppPresentation
    overview: AppsOverview
    pending: string | null
    onConnectStart: () => void
    onAddSlot: () => void
}

// Accounts and slots belong to the workspace and its bill: a member sees them, an admin changes them.
function useBlockedReason(overview: AppsOverview): { reason: string | undefined; adminOnly: boolean } {
    const t = useTranslations('apps')
    const isAdmin = useIsWorkspaceAdmin()
    return isAdmin ? { reason: blockedReason(t, overview), adminOnly: false } : { reason: t('blocked.adminOnly'), adminOnly: true }
}

// What a workspace sees before its first account: what the app does, what it costs, one way in.
export function IntroScreen({ presentation, overview, pending, onConnectStart, onAddSlot }: IntroScreenProps) {
    const t = useTranslations('apps')
    const { name, providerLabel } = appInfo(presentation.slug)
    const { reason: blocked } = useBlockedReason(overview)
    const { headline, detail } = offer(t, overview)

    return (
        <>
            <PanelScroller className="px-5 pb-6 sm:px-8">
                <AppRerunLink slug={presentation.slug} className="pt-10 pb-8 max-sm:pt-6 max-sm:pb-6" />
                <div className="flex flex-col items-center gap-2 text-center">
                    <h2 className="text-xl font-semibold tracking-tight">{name}</h2>
                    <p className="max-w-sm text-sm text-pretty text-muted-foreground">{t(`presentation.pitch.${presentation.slug}`)}</p>
                </div>
                <ul className="mx-auto mt-6 max-w-md space-y-3">
                    {presentation.capabilities.map(capability => (
                        <li key={capability.key} className="flex items-start gap-3">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                                <capability.icon className="size-4 text-muted-foreground" />
                            </span>
                            <span className="min-w-0">
                                <span className="block text-sm font-medium">{t(`presentation.capabilities.${capability.key}.title`)}</span>
                                <span className="block text-xs text-pretty text-muted-foreground">{t(`presentation.capabilities.${capability.key}.text`)}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            </PanelScroller>
            <footer className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-xs">
                    <p className="font-medium">{headline}</p>
                    <p className="text-muted-foreground">{detail}</p>
                </div>
                {overview.allowance === 'buy_slot' && !blocked ? (
                    <AddSlotConfirm overview={overview} pending={pending === 'slot'} onAddSlot={onAddSlot}>
                        <Button loading={pending === 'slot'} className="max-sm:w-full">
                            {t('addSlot.button')}
                        </Button>
                    </AddSlotConfirm>
                ) : (
                    <TooltipDisabledReason reason={blocked} className="max-sm:flex max-sm:w-full">
                        <Button disabled={!!blocked} onClick={onConnectStart} className="max-sm:w-full">
                            {t('intro.connect', { provider: providerLabel })}
                            <ArrowRightIcon />
                        </Button>
                    </TooltipDisabledReason>
                )}
            </footer>
        </>
    )
}

type AccountsScreenProps = {
    overview: AppsOverview
    pending: string | null
    onConnectStart: () => void
    onReconnect: (connection: AppConnectionView) => void
    onDisconnect: (connection: AppConnectionView) => void
    onAddSlot: () => void
}

// Every account and every slot in one list: a slot is either an account or a dashed place for one.
export function AccountsScreen({ overview, pending, onConnectStart, onReconnect, onDisconnect, onAddSlot }: AccountsScreenProps) {
    const t = useTranslations('apps')
    const locale = useLocale()
    const { providerLabel } = appInfo(overview.slug)
    const total = slotTotal(overview)
    const used = overview.connections.length
    const { reason: blocked, adminOnly: blockedForMember } = useBlockedReason(overview)
    const adminOnly = blockedForMember ? blocked : undefined
    const freeSlots = overview.allowance === 'buy_slot' ? 0 : Math.max(1, total - used)

    return (
        <>
            <PanelScroller className="space-y-4 p-4">
                {overview.paused && (
                    <Alert variant="warning">
                        <AlertDescription>{t('accounts.pausedAlert', { provider: providerLabel })}</AlertDescription>
                    </Alert>
                )}
                <div className="space-y-1.5">
                    {overview.connections.map(connection => (
                        <AccountRow key={connection.id} slug={overview.slug} connection={connection} busy={pending === connection.id} reconnectBlocked={overview.paused} adminOnly={adminOnly} onReconnect={onReconnect} onDisconnect={onDisconnect} />
                    ))}
                    {Array.from({ length: freeSlots }, (_, index) => (
                        <OpenSlotRow key={index} title={t('accounts.freeSlot')} description={freeSlotHint(t, overview)} blocked={blocked} onClick={onConnectStart} />
                    ))}
                    {freeSlots === 0 && <AddSlotRow overview={overview} blocked={blocked} pending={pending === 'slot'} onAddSlot={onAddSlot} />}
                </div>
            </PanelScroller>
            <footer className="border-t px-4 py-3 text-xs text-muted-foreground">
                {t.rich('slots.footer', {
                    used,
                    total,
                    description: slotsDescription(t, overview, locale),
                    b: chunks => <span className="font-medium text-foreground tabular-nums">{chunks}</span>,
                })}
            </footer>
        </>
    )
}

function freeSlotHint(t: AppsTranslator, overview: AppsOverview): string {
    if (overview.allowance === 'subscriber_trial') return t('accounts.freeSlotHint.subscriberTrial', { days: TRIAL_DAYS })
    if (overview.allowance === 'workspace_trial_slot') return t('accounts.freeSlotHint.workspaceTrial')
    return t('accounts.freeSlotHint.default', { provider: appInfo(overview.slug).providerLabel })
}

const OPEN_SLOT = 'flex w-full items-center gap-3 rounded-md border border-dashed p-3 text-left transition-colors hover:border-foreground/30 hover:bg-accent/20 disabled:pointer-events-none disabled:opacity-60'

// A slot with nothing in it yet: what gets the dashed border instead of an account.
function OpenSlotButton({ title, description, className, ...props }: ComponentProps<'button'> & { title: string; description: string }) {
    return (
        <button type="button" className={cn(OPEN_SLOT, className)} {...props}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground">
                <PlusIcon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
            </span>
        </button>
    )
}

function OpenSlotRow({ title, description, blocked, onClick }: { title: string; description: string; blocked?: string; onClick: () => void }) {
    return (
        <TooltipDisabledReason reason={blocked} className="flex w-full">
            <OpenSlotButton title={title} description={description} disabled={!!blocked} onClick={onClick} />
        </TooltipDisabledReason>
    )
}

function AddSlotRow({ overview, blocked, pending, onAddSlot }: { overview: AppsOverview; blocked?: string; pending: boolean; onAddSlot: () => void }) {
    const t = useTranslations('apps')
    const title = t('accounts.addAnother')
    const description = t('accounts.addAnotherHint', { price: slotPriceLabel(t, overview) })
    if (blocked) {
        return (
            <TooltipDisabledReason reason={blocked} className="flex w-full">
                <OpenSlotButton title={title} description={description} disabled />
            </TooltipDisabledReason>
        )
    }
    return (
        <AddSlotConfirm overview={overview} pending={pending} onAddSlot={onAddSlot}>
            <OpenSlotButton title={title} description={description} disabled={pending} />
        </AddSlotConfirm>
    )
}

// A WhatsApp number without a display name has no letters: its last two digits stand in.
function initials(name: string): string {
    const letters = name
        .split(/[\s,]+/)
        .filter(word => /^\p{L}/u.test(word))
        .slice(0, 2)
        .map(word => word[0])
        .join('')
        .toUpperCase()
    return letters || name.replace(/\D/g, '').slice(-2)
}

export function AccountAvatar({ name }: { name: string }) {
    return <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted/60 text-[11px] font-semibold text-muted-foreground">{initials(name)}</span>
}

function AccountStatus({ connection }: { connection: AppConnectionView }) {
    const t = useTranslations('apps.accounts.status')
    if (connection.status === 'connected') {
        return (
            <Badge size="xs" tone="green" className="shrink-0">
                {t('connected')}
            </Badge>
        )
    }
    if (connection.status === 'needs_reconnect') {
        // The Reconnect button beside it already says so, and a phone has no room for both.
        return (
            <Badge size="xs" tone="orange" className="shrink-0 max-sm:hidden">
                {t('needsReconnect')}
            </Badge>
        )
    }
    if (connection.status === 'paused') {
        return (
            <Badge size="xs" tone="orange" className="shrink-0">
                {t('paused')}
            </Badge>
        )
    }
    return (
        <Badge size="xs" tone="neutral" className="shrink-0">
            {connection.status === 'connecting' ? t('connecting') : t('disconnected')}
        </Badge>
    )
}

function accountSummary(t: AppsTranslator, slug: AppSlug, connection: AppConnectionView): string {
    const provider = appInfo(slug).providerLabel
    if (connection.status === 'needs_reconnect') return connection.pauseReason === 'workspace_paused' ? t('accounts.summary.signedOutWhilePaused') : t('accounts.summary.signedOut', { provider })
    if (connection.status === 'paused') return connection.pauseReason === 'rate_limited' ? t('accounts.summary.rateLimited', { provider }) : t('accounts.summary.unpaid')
    if (connection.agents.length === 0) return t('accounts.summary.unused')
    return t('accounts.summary.usedBy', { names: connection.agents.map(agent => agent.name).join(', ') })
}

function AccountRow({
    slug,
    connection,
    busy,
    reconnectBlocked,
    adminOnly,
    onReconnect,
    onDisconnect,
}: {
    slug: AppSlug
    connection: AppConnectionView
    busy: boolean
    reconnectBlocked: boolean
    adminOnly?: string
    onReconnect: (connection: AppConnectionView) => void
    onDisconnect: (connection: AppConnectionView) => void
}) {
    const t = useTranslations('apps')
    const { providerLabel } = appInfo(slug)
    const name = connection.label ?? t('accounts.defaultName', { provider: providerLabel })
    return (
        <PanelRow
            leading={<AccountAvatar name={name} />}
            title={name}
            description={accountSummary(t, slug, connection)}
            actions={
                <>
                    <AccountStatus connection={connection} />
                    {connection.status === 'needs_reconnect' && (
                        <TooltipDisabledReason reason={adminOnly}>
                            <Button size="xs" variant="outline" disabled={reconnectBlocked || !!adminOnly} loading={busy} onClick={() => onReconnect(connection)}>
                                {t('accounts.reconnect')}
                            </Button>
                        </TooltipDisabledReason>
                    )}
                    {adminOnly ? (
                        <TooltipDisabledReason reason={adminOnly}>
                            <Button size="icon-sm" variant="ghost" className="text-muted-foreground" disabled aria-label={t('accounts.disconnectLabel', { name })}>
                                <LogOutIcon />
                            </Button>
                        </TooltipDisabledReason>
                    ) : (
                        <TooltipProvider>
                            <Tooltip>
                                <ConfirmDialog
                                    title={t('accounts.disconnectTitle', { name })}
                                    description={t('accounts.disconnectDescription', { provider: providerLabel })}
                                    confirmLabel={t('accounts.disconnect')}
                                    pending={busy}
                                    onConfirm={() => onDisconnect(connection)}
                                >
                                    <TooltipTrigger asChild>
                                        <Button size="icon-sm" variant="ghost" className="text-muted-foreground" disabled={busy} aria-label={t('accounts.disconnectLabel', { name })}>
                                            <LogOutIcon />
                                        </Button>
                                    </TooltipTrigger>
                                </ConfirmDialog>
                                <TooltipContent>{t('accounts.disconnectTooltip')}</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </>
            }
        />
    )
}

export function AccountsSkeleton() {
    return (
        <div className="space-y-1.5 p-4">
            {[0, 1].map(index => (
                <div key={index} className="flex items-center gap-3 rounded-md border p-3">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-28" />
                        <Skeleton className="h-2.5 w-40" />
                    </div>
                    <Skeleton className="h-4 w-12 rounded-full" />
                </div>
            ))}
        </div>
    )
}

// The top of a drilled-in page, as in AI providers: back, the app, what this page does.
export function AppPageHeader({ slug, title, hint, backLabel, onBack }: { slug: AppSlug; title: string; hint: ReactNode; backLabel: string; onBack: () => void }) {
    return (
        <div className="flex items-center gap-3 border-b px-3 py-2.5">
            <Button aria-label={backLabel} variant="ghost" size="icon-sm" className="shrink-0" onClick={onBack}>
                <ChevronLeftIcon className="size-4" />
            </Button>
            <AppIcon slug={slug} />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{title}</span>
                <span className="truncate text-[11px] text-muted-foreground">{hint}</span>
            </div>
        </div>
    )
}

export function StepHero({ visual, title, children }: { visual: ReactNode; title: string; children: ReactNode }) {
    return (
        <div className="flex flex-col items-center text-center">
            {visual}
            <h3 className="text-base font-semibold">{title}</h3>
            <div className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">{children}</div>
        </div>
    )
}

function ConnectedAppIcon({ slug }: { slug: AppSlug }) {
    const t = useTranslations('apps')
    return (
        <div role="img" aria-label={t('success.connectedIcon', { provider: appInfo(slug).providerLabel })} className="relative mb-5">
            <AppIcon slug={slug} size="xl" tone="green" />
            <span
                className="absolute -right-2 -bottom-2 flex size-6 items-center justify-center rounded-full ring-4 ring-popover"
                style={{ background: 'color-mix(in oklab, var(--color-emerald-500) 18%, var(--popover))' }}
            >
                <BorderBeam pattern="ring" tone="green" glow animated={false} />
                <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            </span>
        </div>
    )
}

export function SuccessScreen({ slug, label, onDone }: { slug: AppSlug; label: string | null; onDone: () => void }) {
    const t = useTranslations('apps.success')
    return (
        <>
            <PanelScroller className="flex flex-col justify-center px-5 pb-6">
                <StepHero visual={<ConnectedAppIcon slug={slug} />} title={t('title', { app: appInfo(slug).name })}>
                    {t.rich('body', { label: label ?? t('yourAccount'), b: chunks => <span className="font-medium text-foreground">{chunks}</span> })}
                </StepHero>
            </PanelScroller>
            <footer className="flex justify-end border-t px-4 py-3">
                <Button onClick={onDone} className="max-sm:w-full">
                    {t('done')}
                </Button>
            </footer>
        </>
    )
}
