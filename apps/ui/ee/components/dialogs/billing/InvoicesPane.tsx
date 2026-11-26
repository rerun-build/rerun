'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { listInvoicesAction } from '@/ee/actions/billing.actions'
import type { InvoiceSummary } from '@/ee/services/billing.service'
import { Skeleton } from '@/components/ui/skeleton'
import { ExternalLinkIcon } from '@/lib/icons'

import { longDate } from './checkout-copy'
import { RightTitle, usd } from './parts'

// The workspace's invoices, newest first: null until they are in, empty when the read failed. A new
// `reload` reads them again, after a payment.
export function useInvoices(reload = 0): InvoiceSummary[] | null {
    const t = useTranslations('billing.plan.invoices')
    const errorText = useErrorText()
    const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null)

    useEffect(() => {
        let cancelled = false
        listInvoicesAction().then(result => {
            if (cancelled) return
            if (!result.ok) toast.error(t('loadFailed'), { description: errorText(result) })
            setInvoices(result.ok ? result.invoices : [])
        })
        return () => {
            cancelled = true
        }
    }, [reload])

    return invoices
}

export function InvoicesPane({ onBack }: { onBack: () => void }) {
    const locale = useLocale()
    const t = useTranslations('billing.plan.invoices')
    const invoices = useInvoices()

    return (
        <>
            <RightTitle onBack={onBack}>{t('title')}</RightTitle>
            <div className="mt-6 flex flex-col divide-y divide-border rounded-xl bg-background/60 ring-1 ring-border">
                {invoices === null
                    ? Array.from({ length: 4 }, (_, index) => (
                          <div key={index} className="flex items-center justify-between px-4 py-3">
                              <Skeleton className="h-4 w-24" />
                              <Skeleton className="h-4 w-16" />
                          </div>
                      ))
                    : invoices.length === 0
                      ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
                      : invoices.map(invoice => (
                            <a
                                key={invoice.id}
                                href={invoice.pdfUrl ?? invoice.hostedUrl ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-background"
                            >
                                <span>{longDate(invoice.createdAt, locale)}</span>
                                <span className="flex items-center gap-3">
                                    {invoice.status !== 'paid' && <span className="text-xs text-muted-foreground capitalize">{invoiceStatusLabel(invoice.status, t)}</span>}
                                    <span className="tabular-nums">{usd(invoice.amountCents)}</span>
                                    <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
                                </span>
                            </a>
                        ))}
            </div>
        </>
    )
}

const INVOICE_STATUSES = ['draft', 'open', 'uncollectible', 'void'] as const

export function invoiceStatusLabel(status: string, t: ReturnType<typeof useTranslations<'billing.plan.invoices'>>): string {
    const known = INVOICE_STATUSES.find(candidate => candidate === status)
    return known ? t(`status.${known}`) : status
}
