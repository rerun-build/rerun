'use client'

import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import type { InvoiceSummary, SubscriptionState } from '@/ee/services/billing.service'
import { appInfo } from '@/lib/apps/catalog'
import { DownloadIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { BusinessDetailsForm, countryName, TaxIdStatusBadge } from '../BusinessDetailsPane'
import { CardSetupForm } from '../CardSetup'
import { invoiceStatusLabel } from '../InvoicesPane'
import { SummaryRows, usd } from '../parts'
import { FriendList, ReferralLinkField } from '../referrals/ReferralsPane'
import { billingDate, CardLine, Explain, Panel, TILE_FRAME } from './bits'
import type { PanelProps, TilesData } from './views'

export function PaymentPanel({ state, go }: PanelProps) {
    const t = useTranslations('billing.tiles.payment')
    const tBusiness = useTranslations('billing.business')
    const locale = useLocale()
    const { business } = state
    return (
        <Panel>
            <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{t('card')}</p>
                <CardLine card={state.card} action={state.card ? t('replace') : t('add')} onAction={() => go('card')} />
                <p className="text-xs text-muted-foreground">{t('everyCharge')}</p>
            </div>
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{t('onInvoices')}</p>
                    <TooltipDisabledReason reason={business.country ? undefined : tBusiness('noAddress')}>
                        <Button size="xs" variant="ghost" disabled={!business.country} onClick={() => go('business')}>
                            {t('edit')}
                        </Button>
                    </TooltipDisabledReason>
                </div>
                <SummaryRows
                    rows={[
                        { label: t('company'), value: business.name ?? '-', muted: !business.name },
                        { label: t('country'), value: business.country ? countryName(business.country, locale) : '-', muted: !business.country },
                        {
                            label: t('taxId'),
                            value: business.taxId ? (
                                <span className="inline-flex items-center gap-2">
                                    {business.taxId.value}
                                    <TaxIdStatusBadge status={business.taxId.status} />
                                </span>
                            ) : (
                                '-'
                            ),
                            muted: !business.taxId,
                        },
                    ]}
                />
            </div>
        </Panel>
    )
}

// A new card, or the card that pays a declined invoice: saving it retries the invoice.
export function CardPanel({ state, onDone }: PanelProps) {
    const t = useTranslations('billing.tiles.payment')
    const locale = useLocale()
    const pastDue = state.status === 'past_due'
    const due = pastDue && state.openInvoice ? state.openInvoice : null
    return (
        <Panel>
            <CardSetupForm
                cta={due ? t('saveAndPay', { amount: usd(due.amountCents) }) : t('saveCard')}
                footnote={due ? undefined : t('cardFootnote')}
                onSaved={() => void onDone(pastDue ? { title: t('success.paidTitle'), body: t('success.paidBody') } : { title: t('success.cardTitle'), body: t('success.cardBody') })}
            >
                {due && <SummaryRows rows={[{ label: t('invoiceOf', { date: billingDate(due.createdAt, locale) }), value: usd(due.amountCents), strong: true }]} />}
            </CardSetupForm>
        </Panel>
    )
}

export function BusinessPanel({ state, onDone }: { state: Pick<SubscriptionState, 'business'>; onDone: PanelProps['onDone'] }) {
    const t = useTranslations('billing.tiles.payment')
    return (
        <Panel>
            <BusinessDetailsForm
                business={state.business}
                onSaved={async () => undefined}
                onDone={outcome => void onDone(outcome === 'saved' ? { title: t('success.detailsTitle'), body: t('success.detailsBody') } : { title: t('success.numberRemovedTitle'), body: t('success.detailsBody') })}
            />
        </Panel>
    )
}

type TilesT = ReturnType<typeof useTranslations<'billing.tiles'>>
type MachineSizeT = ReturnType<typeof useTranslations<'billing.machine.sizes'>>

// "Pro + LinkedIn Pro", "2 credit packs", "LinkedIn Pro (prorated)": what an invoice charged for.
export function invoiceLabel(invoice: Pick<InvoiceSummary, 'items' | 'prorated'>, t: TilesT, tSize: MachineSizeT): string {
    const names = invoice.items.map(item => {
        if (item.kind === 'plan') return t('invoice.plan')
        if (item.kind === 'machine') return t('invoice.machine', { size: tSize(item.size) })
        if (item.kind === 'storage') return t('invoice.storage', { count: item.quantity })
        if (item.kind === 'credit_pack') return t('invoice.creditPacks', { count: item.quantity })
        return t('invoice.appSlots', { app: appInfo(item.app).name, count: item.quantity })
    })
    if (!names.length) return t('invoice.other')
    const joined = names.join(' + ')
    return invoice.prorated ? t('invoice.prorated', { items: joined }) : joined
}

export function InvoiceBadge({ status }: { status: string }) {
    const t = useTranslations('billing.tiles.invoice')
    const tStatus = useTranslations('billing.plan.invoices')
    if (status === 'paid')
        return (
            <Badge size="sm" tone="green">
                {t('paid')}
            </Badge>
        )
    if (status === 'open')
        return (
            <Badge size="sm" tone="red">
                {t('unpaid')}
            </Badge>
        )
    return (
        <Badge size="sm" tone="neutral">
            {invoiceStatusLabel(status, tStatus)}
        </Badge>
    )
}

export function InvoiceRows({ invoices, limit, download }: { invoices: InvoiceSummary[] | null; limit?: number; download?: boolean }) {
    const t = useTranslations('billing.tiles')
    const tSize = useTranslations('billing.machine.sizes')
    const locale = useLocale()
    if (!invoices) {
        return (
            <div className={cn('divide-y divide-border', TILE_FRAME)}>
                {Array.from({ length: limit ?? 4 }, (_, index) => (
                    <div key={index} className="flex items-center gap-3 px-4 py-3">
                        <Skeleton className="h-4 w-12" />
                        <Skeleton className="h-4 flex-1" />
                        <Skeleton className="h-4 w-14" />
                    </div>
                ))}
            </div>
        )
    }
    const shown = limit ? invoices.slice(0, limit) : invoices
    return (
        <div className={cn('divide-y divide-border', TILE_FRAME)}>
            {shown.map(invoice => {
                const href = invoice.pdfUrl ?? invoice.hostedUrl ?? undefined
                return (
                    <div key={invoice.id} className={cn('flex items-center gap-3 px-4 text-sm', download ? 'py-2' : 'py-2.5')}>
                        <span className="min-w-14 shrink-0 whitespace-nowrap text-muted-foreground">{billingDate(invoice.createdAt, locale)}</span>
                        <span className="min-w-0 flex-1 truncate">{invoiceLabel(invoice, t, tSize)}</span>
                        <span className="tabular-nums">{usd(invoice.amountCents)}</span>
                        <InvoiceBadge status={invoice.status} />
                        {download && href && (
                            <Button asChild size="icon-sm" variant="ghost" aria-label={t('invoice.download')}>
                                <a href={href} target="_blank" rel="noreferrer">
                                    <DownloadIcon />
                                </a>
                            </Button>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

export function InvoicesPanel({ state, data }: { state: Pick<SubscriptionState, 'status'>; data: Pick<TilesData, 'invoices'> }) {
    const t = useTranslations('billing.tiles.invoices')
    if (data.invoices && data.invoices.length === 0) return <Explain>{state.status === 'trialing' ? t('emptyTrial') : t('empty')}</Explain>
    return (
        <Panel>
            <InvoiceRows invoices={data.invoices} download />
        </Panel>
    )
}

export function ReferralPanel({ data }: PanelProps) {
    const t = useTranslations('billing.tiles.referral')
    const tReferrals = useTranslations('billing.plan.referrals')
    const { overview, failed } = data.referrals

    if (failed) return <Explain>{tReferrals('loadFailed')}</Explain>
    if (!overview) {
        return (
            <Panel>
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-28 w-full rounded-xl" />
            </Panel>
        )
    }
    const capped = overview.monthsEarned >= overview.cap
    return (
        <Panel>
            <ReferralLinkField link={overview.link} />
            <div className="flex flex-col gap-2">
                <div className="flex justify-between gap-3 text-sm">
                    <span>{t('monthsEarned')}</span>
                    <span className="tabular-nums">{tReferrals('monthsOf', { earned: overview.monthsEarned, cap: overview.cap })}</span>
                </div>
                <Progress value={(Math.min(overview.monthsEarned, overview.cap) / overview.cap) * 100} size="sm" label={tReferrals('progressLabel', { earned: overview.monthsEarned, cap: overview.cap })} />
                {capped ? <p className="text-xs text-muted-foreground">{tReferrals('capped', { cap: overview.cap })}</p> : overview.monthsEarned > 0 && <p className="text-xs text-muted-foreground">{t('takenOff')}</p>}
            </div>
            {overview.friends.length > 0 ? <FriendList friends={overview.friends} more={overview.moreFriends} /> : <Explain>{tReferrals('empty')}</Explain>}
        </Panel>
    )
}
