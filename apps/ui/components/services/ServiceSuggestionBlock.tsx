'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { getCatalogServicesBySlugsAction, getServiceAlternativesAction, getServiceDetailsAction } from '@/app/api/_actions/services.actions'
import { attachVaultEntryAction, coworkerVaultAction } from '@/app/api/_actions/vault.actions'
import { vaultAccountsFor, type VaultAccount } from '@/components/vault/vault-text'
import { useVaultEnabled } from '@/components/layout/FeatureFlagsProvider'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ServiceAlternatives } from '@/components/services/ServiceAlternatives'
import { connectsInOneClick, ServiceConfigForm } from '@/components/services/ServiceConfigForm'
import { useServiceSetupDriver } from '@/components/services/service-setup-driver'
import { openPendingSignInPopup } from '@/components/services/sign-in-popup'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { IconBadge } from '@/components/ui/icon-badge'
import { Separator } from '@/components/ui/separator'
import { StepDots } from '@/components/ui/step-dots'
import { serializeServiceSetupResult } from '@/lib/chat-hitl'
import { serviceIconProps } from '@/lib/services/icons'
import { cn } from '@/lib/utils'
import { MAX_OFFERED_ALTERNATIVES } from '@/lib/services/alternatives'
import type { AgentServiceStatus, AuthMethodSummary, ComposioTarget, ManagedTarget, OAuthTarget, ServiceAlternative, ServiceDetails } from '@/lib/services/types'
import { BorderBeam } from '@rerun/ui'
import { ArrowRight, CheckIcon, Loader2Icon, RefreshCwIcon } from '@/lib/icons'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

type SuggestedService = { slug: string; reason?: string }

type CardStatus = 'pending' | 'connected' | 'skipped'

export type ResolvedService = {
    slug: string
    reason?: string
    name: string
    category: string
    icon: string | null
    authMethods: AuthMethodSummary[]
    installStatus: AgentServiceStatus | null
    installedMethodId?: string
    oauth?: OAuthTarget
    managed?: ManagedTarget
    composio?: ComposioTarget
    notFound: boolean
    alternatives: ServiceAlternative[]
    // The app the agent asked for, once the user picked one of its alternatives instead.
    replaces?: { slug: string; name: string }
    // Accounts of this app the workspace Vault already holds, signed in, that the coworker lacks.
    vaultAccounts?: VaultAccount[]
    // Whether the user may attach them: `manage` on the coworker's Box.
    canAttachVault?: boolean
}


type ServiceSuggestionBlockProps = {
    agentId: string
    services: SuggestedService[]
    // Called once the user is done (set up and/or skipped) — sends a summary chat message
    // that resumes the run.
    onDone: (summary: string) => void
    // Rendered in the thread rather than docked above the composer: no dock margin.
    inline?: boolean
}

function toResolved(suggested: SuggestedService, details: ServiceDetails | null, icon: string | null, alternatives: ServiceAlternative[]): ResolvedService {
    if (!details || details.authMethods.length === 0) return { slug: suggested.slug, reason: suggested.reason, name: suggested.slug, category: 'other', icon, authMethods: [], installStatus: null, notFound: true, alternatives: [] }
    return {
        slug: suggested.slug,
        reason: suggested.reason,
        name: details.name,
        category: details.category,
        icon,
        authMethods: details.authMethods,
        installStatus: details.installStatus,
        installedMethodId: details.installedMethodId,
        oauth: details.oauth,
        managed: details.managed,
        composio: details.composio,
        notFound: false,
        alternatives,
    }
}

function buildSummary(resolved: ResolvedService[], statuses: Record<string, CardStatus>, resetPending: Set<string>): string {
    return serializeServiceSetupResult(
        resolved.map(s => ({
            slug: s.slug,
            name: s.name,
            outcome: s.notFound ? 'not-found' : (statuses[s.slug] ?? 'skipped') === 'connected' ? 'connected' : resetPending.has(s.slug) ? 'reset' : 'skipped',
            replaces: s.replaces?.name,
        })),
    )
}

export function ServiceSuggestionBlock({ agentId, services, onDone, inline }: ServiceSuggestionBlockProps) {
    const vaultEnabled = useVaultEnabled()
    // The caller rebuilds this array on every one of its renders, so keying the load below on its
    // identity would re-fetch and reset the cards each time. Key on the content instead.
    const servicesKey = services.map(s => `${s.slug}\0${s.reason ?? ''}`).join('\x01')
    const suggestedRef = useRef(services)
    suggestedRef.current = services
    const [resolved, setResolved] = useState<ResolvedService[] | null>(null)
    const answeredEmptyRef = useRef(false)

    useEffect(() => {
        let cancelled = false
        const suggested = suggestedRef.current
        const slugs = suggested.map(s => s.slug)
        const load = async () => {
            const [details, catalog, alternatives, vault] = await Promise.all([
                Promise.all(slugs.map(slug => getServiceDetailsAction(agentId, slug))),
                getCatalogServicesBySlugsAction(slugs),
                getServiceAlternativesAction(slugs),
                vaultEnabled ? coworkerVaultAction(agentId) : null,
            ])
            if (cancelled) return
            const iconBySlug = new Map(catalog.map(c => [c.slug, c.icon]))
            setResolved(suggested.map((s, i) => ({ ...toResolved(s, details[i], iconBySlug.get(s.slug) ?? null, alternatives[s.slug] ?? []), vaultAccounts: vaultAccountsFor(vault, s.slug), canAttachVault: vault?.canAttach ?? false })))
        }
        load()
        return () => {
            cancelled = true
        }
    }, [agentId, servicesKey, vaultEnabled])

    useEffect(() => {
        if (!resolved || resolved.length > 0 || answeredEmptyRef.current) return
        answeredEmptyRef.current = true
        onDone(serializeServiceSetupResult([]))
    }, [resolved, onDone])

    if (!resolved) return <ServiceSuggestionLoading />
    if (resolved.length === 0) return null

    return <ServiceSuggestionCard key={servicesKey} agentId={agentId} services={resolved} onDone={onDone} inline={inline} />
}

export function ServiceSuggestionLoading() {
    const t = useTranslations('services.suggestion')
    return (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            <span>{t('loading')}</span>
        </div>
    )
}

// Only an active connector is already done: a needs_auth / needs_config entry is exactly what
// this card exists to finish.
function initialStatuses(services: ResolvedService[]): Record<string, CardStatus> {
    return Object.fromEntries(services.map(c => [c.slug, c.notFound ? 'skipped' : c.installStatus === 'active' ? 'connected' : 'pending'] as const))
}

function firstPendingIndex(services: ResolvedService[]): number {
    const index = services.findIndex(c => !c.notFound && c.installStatus !== 'active')
    return index === -1 ? 0 : index
}

type ServiceSuggestionCardProps = {
    agentId: string
    services: ResolvedService[]
    onDone: (summary: string) => void
    inline?: boolean
    // Mounts with the setup form already unfolded, for the lab that shows every state at once.
    defaultOpen?: boolean
}

export function ServiceSuggestionCard({ agentId, services, onDone, inline, defaultOpen }: ServiceSuggestionCardProps) {
    const t = useTranslations('services')
    const tVault = useTranslations('vault')
    const errorText = useErrorText()
    const driver = useServiceSetupDriver()
    const [resolved, setResolved] = useState(services)
    const [statuses, setStatuses] = useState(() => initialStatuses(services))
    const [current, setCurrent] = useState(() => firstPendingIndex(services))
    const [submitted, setSubmitted] = useState(false)
    // The state above only drives the disabled styling. Two async callbacks fired within the
    // same render — an OAuth result delivered twice, a double click resolving twice — both read
    // the same stale `submitted`, so the latch that actually answers the agent has to be a ref.
    const submittedRef = useRef(false)
    const claimSubmit = () => {
        if (submittedRef.current) return false
        submittedRef.current = true
        setSubmitted(true)
        return true
    }
    const [resetting, setResetting] = useState<string | null>(null)
    const [resetError, setResetError] = useState<string | null>(null)
    const [resetSlugs, setResetSlugs] = useState<Set<string>>(() => new Set())
    // Bumped on every reset so the config form remounts: it reads its initial step from props
    // once, at mount, and never re-derives it.
    const [resetSeq, setResetSeq] = useState(0)
    const [swapping, setSwapping] = useState<string | null>(null)
    const [swapError, setSwapError] = useState<string | null>(null)
    const [openSlugs, setOpenSlugs] = useState<Set<string>>(() => new Set(defaultOpen ? services.map(c => c.slug) : []))
    const setOpen = (slug: string, open: boolean) =>
        setOpenSlugs(prev => {
            const next = new Set(prev)
            if (open) next.add(slug)
            else next.delete(slug)
            return next
        })

    const [autoConnect, setAutoConnect] = useState<{ slug: string; popup: Window | null } | null>(null)
    const dropAutoConnect = () => {
        autoConnect?.popup?.close()
        setAutoConnect(null)
    }

    const locked = submitted
    const last = resolved.length - 1
    const multiple = resolved.length > 1
    const s = resolved[Math.min(current, resolved.length - 1)]
    const status = statuses[s.slug] ?? 'pending'
    const connectable = status === 'pending' && !s.notFound
    const showForm = connectable && openSlugs.has(s.slug)
    const folded = connectable && !showForm
    // An app already on another card would share its status with it, since statuses are keyed by slug.
    const otherSlugs = new Set(resolved.filter(r => r !== s).map(r => r.slug))
    const alternatives = s.alternatives.filter(a => !otherSlugs.has(a.slug))
    const authTarget = s.installStatus === 'needs_auth' && (s.oauth || s.managed || s.composio) ? { oauth: s.oauth, managed: s.managed, composio: s.composio } : undefined

    const connect = () => {
        if (connectsInOneClick(s.authMethods, s.installedMethodId, authTarget)) setAutoConnect({ slug: s.slug, popup: openPendingSignInPopup(s.name, t('signInPopup.connecting', { name: s.name })) })
        setOpen(s.slug, true)
    }

    const cancel = () => {
        dropAutoConnect()
        setOpen(s.slug, false)
    }

    const finish = (finalStatuses: Record<string, CardStatus>) => {
        if (!claimSubmit()) return
        onDone(buildSummary(resolved, finalStatuses, resetSlugs))
    }

    const advance = (nextStatuses: Record<string, CardStatus>) => {
        if (submittedRef.current) return
        dropAutoConnect()
        if (current < last) setCurrent(c => c + 1)
        else finish(nextStatuses)
    }

    // The registry is the only source of truth for what reconnecting means here: a card connected
    // during this very session still holds the details fetched BEFORE the install, with no
    // sign-in target on it. So the mode and the target both come back from the server.
    const reconnect = async () => {
        if (locked || resetting) return
        setResetting(s.slug)
        setResetError(null)
        const res = await driver.reset(agentId, s.slug)
        setResetting(null)
        if (!res.ok) {
            setResetError(errorText(res))
            return
        }
        const reset = res.result
        setResolved(prev =>
            prev.map(c =>
                c.slug === s.slug
                    ? {
                          ...c,
                          installStatus: reset.mode === 'auth' ? 'needs_auth' : 'needs_config',
                          oauth: reset.mode === 'auth' ? reset.oauth : undefined,
                          managed: reset.mode === 'auth' ? reset.managed : undefined,
                          composio: reset.mode === 'auth' ? reset.composio : undefined,
                          installedMethodId: reset.mode === 'config' ? (reset.authMethodId ?? c.installedMethodId) : c.installedMethodId,
                      }
                    : c,
            ),
        )
        setResetSlugs(prev => new Set(prev).add(s.slug))
        setResetSeq(n => n + 1)
        setOpen(s.slug, true)
        setStatuses(st => ({ ...st, [s.slug]: 'pending' }))
    }

    const swapTo = async (alternative: ServiceAlternative) => {
        if (locked || swapping) return
        setSwapping(alternative.slug)
        setSwapError(null)
        const details = await driver.details(agentId, alternative.slug)
        setSwapping(null)
        if (!details || details.authMethods.length === 0) {
            setSwapError(t('suggestion.loadFailed', { name: alternative.name }))
            return
        }
        const original = s.replaces ?? { slug: s.slug, name: s.name }
        const current: ServiceAlternative = { slug: s.slug, name: s.name, category: s.category, icon: s.icon }
        const next = toResolved({ slug: alternative.slug, reason: s.reason }, details, alternative.icon, [current, ...s.alternatives.filter(a => a.slug !== alternative.slug)].slice(0, MAX_OFFERED_ALTERNATIVES))
        next.replaces = alternative.slug === original.slug ? undefined : original
        setResolved(prev => prev.map(c => (c.slug === s.slug ? next : c)))
        setStatuses(st => {
            const { [s.slug]: _replaced, ...rest } = st
            return { ...rest, [next.slug]: next.installStatus === 'active' ? 'connected' : 'pending' }
        })
    }

    const [attaching, setAttaching] = useState<string | null>(null)
    const [attachError, setAttachError] = useState<string | null>(null)
    const attachFromVault = async (account: VaultAccount) => {
        if (locked || attaching) return
        setAttaching(account.id)
        setAttachError(null)
        const res = await attachVaultEntryAction(account.id, agentId)
        setAttaching(null)
        if (!res.ok) return setAttachError(errorText(res))
        const next = { ...statuses, [s.slug]: 'connected' as CardStatus }
        setStatuses(next)
        advance(next)
    }
    const vaultAccounts = s.vaultAccounts ?? []
    const attachReason = s.canAttachVault ? undefined : tVault('reasons.manageBox')

    const skip = () => {
        if (locked) return
        const next = { ...statuses, [s.slug]: 'skipped' as CardStatus }
        setStatuses(next)
        advance(next)
    }

    return (
        <div className={cn('relative space-y-3 overflow-hidden rounded-lg border border-border bg-muted/30 p-3', !inline && 'mb-2')}>
            <BorderBeam animated pattern="arcs" tone="brand" glow width={1} duration={7} />

            <AnimatePresence mode="wait" initial={false}>
                <motion.div key={`${current}:${s.slug}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="relative space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                        <Icon {...serviceIconProps(s.icon, s.category)} size="sm" />
                        <div className="min-w-32 flex-1">
                            <span className="block truncate font-medium leading-snug">{s.name}</span>
                            {s.notFound ? <p className="text-xs text-muted-foreground">{t('suggestion.notFoundSkipped')}</p> : s.reason && <p className="text-xs text-muted-foreground">{s.reason}</p>}
                        </div>
                        {folded && (
                            <div className="flex items-center gap-1">
                                {!multiple && (
                                    <Button size="sm" variant="ghost" disabled={locked} onClick={skip}>
                                        {t('suggestion.notNow')}
                                    </Button>
                                )}
                                <Button size="sm" variant={vaultAccounts.length > 0 ? 'outline' : 'default'} disabled={locked || swapping !== null || attaching !== null} onClick={connect}>
                                    {vaultAccounts.length > 0 ? t('suggestion.connectNew') : t('suggestion.connect')}
                                </Button>
                            </div>
                        )}
                        {showForm && (
                            <Button size="sm" variant="ghost" disabled={locked} onClick={cancel} className="text-muted-foreground">
                                {t('suggestion.cancel')}
                            </Button>
                        )}
                    </div>

                    {folded && vaultAccounts.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-xs text-muted-foreground">{t('suggestion.fromVault')}</p>
                            <div className="flex flex-wrap gap-1.5">
                                {vaultAccounts.map(account => (
                                    <TooltipDisabledReason key={account.id} reason={attachReason} className="max-w-full">
                                        <Button size="sm" className="max-w-full" disabled={locked || attaching !== null || !!attachReason} onClick={() => void attachFromVault(account)}>
                                            {attaching === account.id && <Loader2Icon className="animate-spin" />}
                                            <span className="truncate">{t('suggestion.useAccount', { label: account.label })}</span>
                                        </Button>
                                    </TooltipDisabledReason>
                                ))}
                            </div>
                            {attachError && <p className="text-xs text-destructive">{attachError}</p>}
                        </div>
                    )}

                    {folded && <ServiceAlternatives alternatives={alternatives} swapping={swapping} disabled={locked} error={swapError} onPick={swapTo} />}

                    {!folded && <Separator className="-mx-3 border-t border-dashed bg-transparent data-horizontal:h-0 data-horizontal:w-auto" />}

                    {showForm ? (
                        <ServiceConfigForm
                            key={`${s.slug}:${resetSeq}`}
                            agentId={agentId}
                            slug={s.slug}
                            name={s.name}
                            authMethods={s.authMethods}
                            initialMethodId={s.installedMethodId}
                            initialAuthTarget={authTarget}
                            autoConnect={autoConnect?.slug === s.slug ? autoConnect : undefined}
                            onInstalled={() => {
                                const next = { ...statuses, [s.slug]: 'connected' as CardStatus }
                                setStatuses(next)
                                advance(next)
                            }}
                        />
                    ) : status === 'connected' ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <IconBadge tone="green" icon={CheckIcon} glow={false} />
                            <span className="min-w-0 flex-1 truncate font-medium">{t('suggestion.connected', { name: s.name })}</span>
                            <Button size="sm" variant="ghost" className="-my-1 shrink-0 text-muted-foreground" disabled={locked || resetting === s.slug} onClick={reconnect}>
                                {resetting === s.slug ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                                {t('suggestion.reconnect')}
                            </Button>
                            {resetError && <p className="basis-full text-xs text-destructive">{resetError}</p>}
                        </div>
                    ) : (
                        !folded && <p className="text-sm text-muted-foreground">{s.notFound ? t('suggestion.notFound') : t('suggestion.skipped')}</p>
                    )}
                </motion.div>
            </AnimatePresence>

            {(multiple || status !== 'pending') && (
                <>
                    <Separator className="-mx-3 data-horizontal:w-auto" />
                    <div className="flex items-center gap-2">
                        {multiple && (
                            <StepDots
                                count={resolved.length}
                                current={current}
                                answered={resolved.map(r => (statuses[r.slug] ?? 'pending') === 'connected')}
                                onSelect={i => {
                                    if (locked) return
                                    dropAutoConnect()
                                    setCurrent(i)
                                }}
                                disabled={locked}
                            />
                        )}
                        <div className="ml-auto flex items-center gap-2">
                            {multiple && (
                                <Button size="sm" variant="outline" disabled={locked} onClick={skip}>
                                    {t('suggestion.skip')}
                                </Button>
                            )}
                            <Button size="icon-sm" disabled={locked} onClick={() => advance(statuses)} aria-label={current === last ? t('suggestion.finish') : t('suggestion.nextApp')}>
                                <ArrowRight className="size-4" />
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
