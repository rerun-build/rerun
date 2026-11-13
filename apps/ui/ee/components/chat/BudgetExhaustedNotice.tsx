'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { setRerunCreditPausedAction } from '@/ee/actions/billing.actions'
import { NoticeActions, type NoticeAction } from '@/components/chat/NoticeActions'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { useBillingStore } from '@/stores/billing.store'
import { useWorkspaceSettingsStore } from '@/stores/workspace-settings.store'
import { BorderBeam } from '@rerun/ui'
import { ArrowRightIcon, CheckIcon, CoinsIcon, CreditCardIcon, KeyIcon, LinkIcon, PauseIcon, Play, ZapOffIcon } from '@/lib/icons'
import { usd } from '@/ee/components/dialogs/billing/parts'
import { BASE_PLAN_CREDITS, DEFAULT_PRICE_ARM, TRIAL_CREDITS, ZERO_QUANTITIES, creditsLabel, planPriceCents, type PriceArm } from '@/ee/lib/billing/plans'
import { NOTICE_PERKS } from '@/ee/lib/billing/pro-perks'

type SubscriptionProvider = 'claude' | 'codex'

// `onConnectProvider` opens the workspace's AI providers on the sign-in of the plan that was picked.
// A chat with no board behind it has nowhere to send the user, so it leaves the two buttons out
// rather than showing dead ones, and the notice is down to its one paid way out.
//
// `preTrial` is the foreman's case: the credit that just ran out is the signup allowance, a top-up
// that does not come back, on a workspace with no plan. Telling that user about a monthly reset and
// selling them credits would be wrong twice. Passed in rather than read from the session, so the
// notice keeps rendering in the UI kit, outside every provider.
//
// `trialing` is the same signup allowance running out during the trial: it does not reset either,
// and credit packs are not sold on a trial. What opens more is the plan itself, paid today.
//
// `paused` is a member having turned the credit off: the hub answers the same 402, but nothing ran
// out, and the one way out is turning it back on.
// `ownConnection` is a Claude or ChatGPT plan already connected to the Box while this conversation
// still ran on Rerun: inviting to connect it again would only sign in once more and change nothing.
// Running the conversation on it is the way out that works.
//
// `noCredit` is a workspace that never had any Rerun credit, such as a workspace added before its
// plan: nothing was used up, so the notice does not say it was.
//
// `lifetime` is a workspace on the lifetime plan (an AppSumo code): it has no Rerun credit by design
// and nothing is sold to it, so its only way out is its own AI, an API key first. It is not offered
// the Claude plan, which AppSumo refuses to list.
//
// On a trial, `coworker` names who stopped, `onPaid` hands the checkout a way to pick the task back
// up, and `resuming` is the moment between paying and the plan landing, when the notice turns into
// the receipt. `onResumeNow` is the hand-held way back if that moment drags on.
export type BudgetNoticeOwnConnection = { label: string; provider: string; onUse: () => void }

type TrialUpgrade = { coworker?: string; priceArm?: PriceArm; onPaid?: () => void; resuming?: boolean; onResumeNow?: () => void }

export function BudgetExhaustedNotice({
    onConnectProvider,
    ownConnection,
    preTrial,
    trialing,
    paused,
    noCredit,
    lifetime,
    ...upgrade
}: { onConnectProvider?: (provider: SubscriptionProvider) => void; ownConnection?: BudgetNoticeOwnConnection; preTrial?: boolean; trialing?: boolean; paused?: boolean; noCredit?: boolean; lifetime?: boolean } & TrialUpgrade) {
    const t = useTranslations('chat.budget')
    const openBilling = useBillingStore(s => s.openBilling)
    const errorText = useErrorText()

    if (paused) {
        const resume = async () => {
            const result = await setRerunCreditPausedAction(false)
            if (!result.ok) toast.error(errorText(result))
        }
        return (
            <div className="relative mb-2 space-y-2.5 overflow-hidden rounded-lg px-4 pt-3 pb-4">
                <BorderBeam animated pattern="arcs" tone="orange" glow width={1} duration={7} />
                <div className="flex items-center gap-2.5 text-sm">
                    <Icon size="sm" tone="orange" icon={PauseIcon} />
                    <span className="font-medium">{t('paused.title')}</span>
                </div>
                <p className="text-sm">{t('paused.body')}</p>
                <NoticeActions actions={[{ key: 'resume', leading: <Icon icon={Play} size="sm" />, title: t('paused.actionTitle'), description: t('paused.actionDescription'), cta: t('paused.cta'), onClick: resume }]} />
            </div>
        )
    }

    if (preTrial) {
        return (
            <div className="relative mb-2 space-y-2.5 overflow-hidden rounded-lg px-4 pt-3 pb-4">
                <BorderBeam animated pattern="arcs" tone="red" glow width={1} duration={7} />
                <div className="flex items-center gap-2.5 text-sm">
                    <Icon size="sm" tone="red" icon={ZapOffIcon} className="bg-red-500/10 text-foreground" />
                    <span className="font-medium">{t('title')}</span>
                </div>
                <p className="text-sm">{t('preTrial.body', { credits: creditsLabel(TRIAL_CREDITS) })}</p>
                <NoticeActions actions={[{ key: 'trial', leading: <Icon icon={CreditCardIcon} size="sm" />, title: t('subscribe.title'), description: t('preTrial.actionDescription'), cta: t('subscribe.cta'), onClick: () => openBilling(undefined, 'budget_exhausted_pre_trial') }]} />
            </div>
        )
    }

    if (lifetime) return <LifetimeNotice onConnectProvider={onConnectProvider} ownConnection={ownConnection} />

    if (trialing && !noCredit) return <TrialUpgradeNotice {...upgrade} onConnectProvider={onConnectProvider} ownConnection={ownConnection} />

    // A workspace with no credit at all has no month that will refill it: what opens credit is the plan.
    const paidWayOut: NoticeAction = trialing || noCredit
        ? {
              key: 'plan',
              leading: <Icon icon={CreditCardIcon} size="sm" />,
              title: t('subscribe.title'),
              cta: t('subscribe.cta'),
              description: trialing ? t('subscribe.descriptionTrial', { credits: creditsLabel(BASE_PLAN_CREDITS) }) : t('subscribe.description', { credits: creditsLabel(BASE_PLAN_CREDITS) }),
              onClick: () => openBilling(undefined, trialing ? 'budget_exhausted_trial' : 'budget_exhausted'),
          }
        : {
              key: 'credits',
              leading: <Icon icon={CoinsIcon} size="sm" />,
              title: t('topUp.title'),
              cta: t('topUp.cta'),
              description: t('topUp.description'),
              onClick: () => openBilling('credit_pack', 'budget_exhausted'),
          }
    const usedUp = noCredit ? t('usedUp.noCredit') : trialing ? t('usedUp.trial', { credits: creditsLabel(TRIAL_CREDITS) }) : t('usedUp.period')

    return (
        <div className="relative mb-2 space-y-2.5 overflow-hidden rounded-lg px-4 pt-3 pb-4">
            <BorderBeam animated pattern="arcs" tone="red" glow width={1} duration={7} />
            <div className="flex items-center gap-2.5 text-sm">
                <Icon size="sm" tone="red" icon={ZapOffIcon} className="bg-red-500/10 text-foreground" />
                <span className="font-medium">{t('title')}</span>
            </div>
            {ownConnection ? (
                <>
                    <p className="text-sm">
                        {usedUp} {t('ownConnection.body', { plan: ownConnection.label })}
                    </p>
                    <Button size="sm" className="w-full" onClick={ownConnection.onUse}>
                        <ProviderIcon provider={ownConnection.provider} className="size-3.5" />
                        <span className="truncate">{t('runOn', { plan: ownConnection.label })}</span>
                    </Button>
                    <div className="flex items-center gap-2 text-xs uppercase">
                        <span className="flex-1 border-t" />
                        <span className="text-muted-foreground">{t('or')}</span>
                        <span className="flex-1 border-t" />
                    </div>
                    <NoticeActions actions={[{ ...paidWayOut, variant: 'outline' }]} />
                </>
            ) : onConnectProvider ? (
                <>
                    <p className="text-sm">{usedUp} {t('connectProvider.body')}</p>
                    <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" onClick={() => onConnectProvider('claude')}>
                            <ProviderIcon provider="claude" className="size-3.5" />
                            {t('connectProvider.claude')}
                        </Button>
                        <Button size="sm" onClick={() => onConnectProvider('codex')}>
                            <ProviderIcon provider="openai" className="size-3.5" />
                            {t('connectProvider.chatgpt')}
                        </Button>
                    </div>
                    <div className="flex items-center gap-2 text-xs uppercase">
                        <span className="flex-1 border-t" />
                        <span className="text-muted-foreground">{t('or')}</span>
                        <span className="flex-1 border-t" />
                    </div>
                    <NoticeActions actions={[{ ...paidWayOut, variant: 'outline' }]} />
                </>
            ) : (
                <>
                    <p className="text-sm">{usedUp} {trialing || noCredit ? t('subscribeToKeepWorking') : t('resetsNextMonth')}</p>
                    <NoticeActions actions={[paidWayOut]} />
                </>
            )}
        </div>
    )
}

function LifetimeNotice({ onConnectProvider, ownConnection }: { onConnectProvider?: (provider: SubscriptionProvider) => void; ownConnection?: BudgetNoticeOwnConnection }) {
    const t = useTranslations('chat.budget')
    const openAiProviders = useWorkspaceSettingsStore(s => s.openAiProviders)

    return (
        <div className="relative mb-2 space-y-2.5 overflow-hidden rounded-lg px-4 pt-3 pb-4">
            <BorderBeam animated pattern="arcs" tone="red" glow width={1} duration={7} />
            <div className="flex items-center gap-2.5 text-sm">
                <Icon size="sm" tone="red" icon={ZapOffIcon} className="bg-red-500/10 text-foreground" />
                <span className="font-medium">{t('title')}</span>
            </div>
            {ownConnection ? (
                <>
                    <p className="text-sm">{t('lifetime.ownConnection', { plan: ownConnection.label })}</p>
                    <Button size="sm" className="w-full" onClick={ownConnection.onUse}>
                        <ProviderIcon provider={ownConnection.provider} className="size-3.5" />
                        <span className="truncate">{t('runOn', { plan: ownConnection.label })}</span>
                    </Button>
                </>
            ) : onConnectProvider ? (
                <>
                    <p className="text-sm">{t('lifetime.connectProvider')}</p>
                    <NoticeActions actions={[{ key: 'api-key', leading: <Icon icon={KeyIcon} size="sm" />, title: t('lifetime.apiKeyTitle'), description: t('lifetime.apiKeyDescription'), cta: t('lifetime.apiKeyCta'), onClick: () => openAiProviders() }]} />
                    <div className="flex items-center gap-2 text-xs uppercase">
                        <span className="flex-1 border-t" />
                        <span className="text-muted-foreground">{t('or')}</span>
                        <span className="flex-1 border-t" />
                    </div>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => onConnectProvider('codex')}>
                        <ProviderIcon provider="openai" className="size-3.5" />
                        {t('connectProvider.chatgpt')}
                    </Button>
                </>
            ) : (
                <>
                    <p className="text-sm">{t('lifetime.body')}</p>
                    <NoticeActions actions={[{ key: 'connect', leading: <Icon icon={LinkIcon} size="sm" />, title: t('lifetime.connectTitle'), description: t('lifetime.connectDescription'), cta: t('lifetime.connectCta'), onClick: () => openAiProviders() }]} />
                </>
            )}
        </div>
    )
}

function TrialUpgradeNotice({ coworker, priceArm = DEFAULT_PRICE_ARM, onPaid, resuming, onResumeNow, onConnectProvider, ownConnection }: TrialUpgrade & { onConnectProvider?: (provider: SubscriptionProvider) => void; ownConnection?: BudgetNoticeOwnConnection }) {
    const t = useTranslations('chat.budget')
    const tPerks = useTranslations('billing.perks.headlines')
    const openBilling = useBillingStore(s => s.openBilling)

    if (resuming) {
        return (
            <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-2 px-1 text-sm">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-500/15 text-green-500 ring-1 ring-green-500/30">
                    <CheckIcon className="size-3" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="font-medium">{t('trial.onPro')}</span> <span className="text-muted-foreground">{coworker ? t('trial.resumingNamed', { name: coworker }) : t('trial.resuming')}</span>
                </span>
                {onResumeNow && (
                    <Button size="xs" variant="outline" onClick={onResumeNow}>
                        {t('paused.cta')}
                    </Button>
                )}
            </div>
        )
    }

    const monthly = usd(planPriceCents(ZERO_QUANTITIES, 'monthly', priceArm))
    return (
        <div className="relative mb-2 space-y-3 overflow-hidden rounded-lg px-4 pt-3 pb-4">
            <BorderBeam animated pattern="arcs" tone="red" glow width={1} duration={7} />
            <div className="flex items-start gap-2.5">
                <Icon size="sm" tone="red" icon={ZapOffIcon} className="bg-red-500/10 text-foreground" />
                <div className="min-w-0 text-sm">
                    <p className="font-medium">{t('trial.title')}</p>
                    {coworker && <p className="text-muted-foreground">{t('trial.stopped', { name: coworker })}</p>}
                </div>
            </div>
            <Button size="lg" className="w-full" onClick={() => openBilling(undefined, 'budget_exhausted_trial', { coworker, onPaid })}>
                <span className="truncate">{t('trial.continueWithPro', { price: monthly })}</span>
                <ArrowRightIcon className="size-3.5" />
            </Button>
            <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                {NOTICE_PERKS.map(perk => (
                    <li key={perk.id} className="flex items-center gap-1.5 text-xs">
                        <CheckIcon className="size-3.5 shrink-0 text-green-500" />
                        {tPerks(perk.id as 'credits' | 'coworkers' | 'team', { credits: BASE_PLAN_CREDITS })}
                    </li>
                ))}
            </ul>
            {ownConnection ? (
                <div className="flex justify-center">
                    <Button size="xs" variant="ghost" className="max-w-full text-muted-foreground" onClick={ownConnection.onUse}>
                        <ProviderIcon provider={ownConnection.provider} className="size-3" />
                        <span className="truncate">{t('runOn', { plan: ownConnection.label })}</span>
                    </Button>
                </div>
            ) : (
                onConnectProvider && (
                    <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
                        <span>{t('trial.useMyPlan')}</span>
                        <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => onConnectProvider('claude')}>
                            <ProviderIcon provider="claude" className="size-3" />
                            Claude
                        </Button>
                        <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => onConnectProvider('codex')}>
                            <ProviderIcon provider="openai" className="size-3" />
                            ChatGPT
                        </Button>
                    </div>
                )
            )}
        </div>
    )
}
