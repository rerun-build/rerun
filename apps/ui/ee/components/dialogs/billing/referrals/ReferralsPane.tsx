'use client'

import { Badge, InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, type BadgeTone } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'

import { Skeleton } from '@/components/ui/skeleton'
import { REFERRAL_MILESTONES, type ReferralFriend, type ReferralOverview, type ReferralStatus } from '@/ee/lib/billing/referral'
import type { SubscriptionState } from '@/ee/services/billing.service'
import { CheckIcon, CopyIcon } from '@/lib/icons'
import { useCopy } from '@/lib/use-copy'
import { cn } from '@/lib/utils'

import { shortDate } from '../checkout-copy'
import { KIND_FILL } from '../credit-usage/parts'
import { RightTitle, usd } from '../parts'

const STATUS_TONE: Record<ReferralStatus, BadgeTone> = { subscribed: 'green', trial: 'brand', signed_up: 'neutral', canceled: 'neutral' }

const EARNED_FILL = KIND_FILL.ai

function ReferralLinkField({ link }: { link: string }) {
    const t = useTranslations('billing.plan.referrals')
    const { copied, copy } = useCopy()
    return (
        <InputGroup className="h-10">
            <InputGroupInput readOnly value={link.replace(/^https?:\/\//, '')} aria-label={t('linkLabel')} className="font-mono text-xs" onFocus={event => event.currentTarget.select()} />
            <InputGroupAddon align="inline-end">
                <InputGroupButton size="sm" variant="secondary" onClick={() => copy(link)}>
                    {copied ? <CheckIcon /> : <CopyIcon />}
                    {copied ? t('copied') : t('copy')}
                </InputGroupButton>
            </InputGroupAddon>
        </InputGroup>
    )
}

// A thin track with the steps worth reaching on it: a dot per milestone, checked once passed.
function MonthsMilestones({ earned, cap }: { earned: number; cap: number }) {
    const t = useTranslations('billing.plan.referrals')
    return (
        <div className="relative pt-1 pb-6" role="img" aria-label={t('progressLabel', { earned, cap })}>
            <div className="relative h-1.5 w-full rounded-full bg-muted-foreground/20">
                <span className={cn('absolute inset-y-0 left-0 rounded-full', EARNED_FILL)} style={{ width: `${(Math.min(earned, cap) / cap) * 100}%` }} />
            </div>
            {REFERRAL_MILESTONES.map(step => {
                const reached = earned >= step
                return (
                    <span key={step} className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1.5 last:translate-x-[-100%] last:items-end" style={{ left: `${(step / cap) * 100}%` }}>
                        <span className={cn('flex size-3.5 items-center justify-center rounded-full ring-2 ring-background', reached ? EARNED_FILL : 'bg-muted')}>{reached && <CheckIcon className="size-2.5 text-white" />}</span>
                        <span className={cn('text-[10px] tabular-nums', reached ? 'text-foreground' : 'text-muted-foreground')}>{step}</span>
                    </span>
                )
            })}
        </div>
    )
}

function FriendRow({ friend }: { friend: ReferralFriend }) {
    const t = useTranslations('billing.plan.referrals.status')
    const label = friend.name ?? friend.email ?? ''
    return (
        <li className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground uppercase ring-1 ring-border">{label.slice(0, 1)}</span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{label}</p>
                {friend.name && friend.email && <p className="truncate text-xs text-muted-foreground">{friend.email}</p>}
            </div>
            <Badge size="xs" tone={STATUS_TONE[friend.status]} className={cn('shrink-0', friend.status === 'canceled' && 'opacity-60')}>
                {t(friend.status)}
            </Badge>
        </li>
    )
}

function FriendList({ friends, more }: { friends: ReferralFriend[]; more: number }) {
    const t = useTranslations('billing.plan.referrals')
    return (
        <ul className="flex flex-col divide-y divide-border rounded-xl bg-background/60 ring-1 ring-border">
            {friends.map(friend => (
                <FriendRow key={friend.id} friend={friend} />
            ))}
            {more > 0 && <li className="px-3 py-2.5 text-xs text-muted-foreground">{t('more', { count: more })}</li>}
        </ul>
    )
}

function PaneSkeleton() {
    return (
        <>
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-[7.5rem] w-full rounded-xl" />
            <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-[6.5rem] w-full rounded-xl" />
            </div>
        </>
    )
}

export function ReferralsPane({ overview, failed, nextInvoice, onBack }: { overview: ReferralOverview | null; failed: boolean; nextInvoice: SubscriptionState['nextInvoice']; onBack: () => void }) {
    const locale = useLocale()
    const t = useTranslations('billing')
    const capped = !!overview && overview.monthsEarned >= overview.cap

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
                <RightTitle onBack={onBack} backLabel={t('plan.overview.title')}>
                    {t('plan.referrals.title')}
                </RightTitle>
                <p className="text-sm text-muted-foreground">{t('plan.referrals.pitch')}</p>
            </div>
            {failed ? (
                <p className="rounded-xl bg-background/60 px-4 py-6 text-center text-xs text-muted-foreground ring-1 ring-border">{t('plan.referrals.loadFailed')}</p>
            ) : !overview ? (
                <PaneSkeleton />
            ) : (
                <>
                    {capped && <p className="rounded-xl bg-background/60 px-4 py-3 text-sm text-muted-foreground ring-1 ring-border">{t('plan.referrals.capped', { cap: overview.cap })}</p>}
                    <ReferralLinkField link={overview.link} />
                    <div className="flex flex-col gap-3 rounded-xl bg-background/60 px-4 pt-3 ring-1 ring-border">
                        <div className="flex items-baseline justify-between gap-4 text-sm">
                            <span className="font-medium">{t('plan.referrals.freeMonths')}</span>
                            <span className="tabular-nums">{t('plan.referrals.monthsOf', { earned: overview.monthsEarned, cap: overview.cap })}</span>
                        </div>
                        <MonthsMilestones earned={overview.monthsEarned} cap={overview.cap} />
                        <div className="-mx-4 flex items-baseline justify-between gap-4 border-t px-4 py-3 text-sm">
                            <span className="text-muted-foreground">{t('plan.nextInvoice')}</span>
                            <span className={cn('text-right tabular-nums', !nextInvoice && 'text-muted-foreground')}>{nextInvoice ? `${shortDate(nextInvoice.at, locale)} · ${usd(nextInvoice.amountCents)}` : t('plan.referrals.firstPayment')}</span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <p className="text-sm font-medium">{t('plan.referrals.friends')}</p>
                        {overview.friends.length > 0 ? <FriendList friends={overview.friends} more={overview.moreFriends} /> : <p className="rounded-xl bg-background/60 px-4 py-6 text-center text-xs text-muted-foreground ring-1 ring-border">{t('plan.referrals.empty')}</p>}
                    </div>
                </>
            )}
        </div>
    )
}
