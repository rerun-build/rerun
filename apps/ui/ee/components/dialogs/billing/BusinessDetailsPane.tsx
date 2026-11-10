'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { Badge } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { removeTaxIdAction, saveBusinessDetailsAction } from '@/ee/actions/billing.actions'
import { TAX_ID_STATUS_BADGE, taxIdPlaceholder, taxIdTypeLabel, taxIdTypesFor, type TaxIdStatus, type TaxIdType } from '@/ee/lib/billing/tax-id'
import type { BusinessDetails } from '@/ee/services/billing.service'
import { Building2, ChevronRightIcon } from '@/lib/icons'

import { PayFooter, RightTitle } from './parts'

function countryName(country: string, locale: string): string {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country
}

function TaxIdStatusBadge({ status }: { status: TaxIdStatus | null }) {
    const t = useTranslations('billing.business.status')
    const badge = status ? TAX_ID_STATUS_BADGE[status] : null
    if (!status || !badge) return null
    return (
        <Badge size="sm" tone={badge.tone}>
            {t(status as Exclude<TaxIdStatus, 'unavailable'>)}
        </Badge>
    )
}

export function BusinessDetailsRow({ business, onOpen }: { business: BusinessDetails; onOpen: () => void }) {
    const t = useTranslations('billing.business')
    const disabled = !business.country
    return (
        <TooltipDisabledReason reason={disabled ? t('noAddress') : undefined} className="w-full">
            <button
                type="button"
                onClick={onOpen}
                disabled={disabled}
                className="flex w-full items-center justify-between gap-3 rounded-xl bg-background/60 px-4 py-3 text-sm ring-1 ring-border hover:bg-background disabled:pointer-events-none disabled:opacity-60"
            >
                <span className="flex shrink-0 items-center gap-3">
                    <Building2 className="size-4 text-muted-foreground" />
                    {t('title')}
                </span>
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    {business.taxId ? (
                        <>
                            <span className="truncate tabular-nums">{business.taxId.value}</span>
                            <TaxIdStatusBadge status={business.taxId.status} />
                        </>
                    ) : (
                        <span>{t('add')}</span>
                    )}
                    <ChevronRightIcon className="size-4 shrink-0" />
                </span>
            </button>
        </TooltipDisabledReason>
    )
}

// Only reached with a billing country: the row stays disabled without one.
export function BusinessDetailsPane({ business, onBack, onSaved }: { business: BusinessDetails; onBack: () => void; onSaved: () => Promise<void> }) {
    const t = useTranslations('billing.business')
    const errorText = useErrorText()
    const locale = useLocale()
    const country = business.country ?? ''
    const types = taxIdTypesFor(country)
    const [name, setName] = useState(business.name ?? '')
    const [type, setType] = useState<TaxIdType | undefined>(business.taxId?.type ?? types[0])
    const [value, setValue] = useState(business.taxId?.value ?? '')
    const [saving, setSaving] = useState(false)
    const [removing, setRemoving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const unchanged = name.trim() === (business.name ?? '') && type === business.taxId?.type && value.trim() === (business.taxId?.value ?? '')
    const savedNumberShown = !!business.taxId && type === business.taxId.type && value.trim() === business.taxId.value

    const save = async () => {
        if (!type) return
        setSaving(true)
        setError(null)
        const result = await saveBusinessDetailsAction({ name, type, value })
        if (!result.ok) {
            setSaving(false)
            return setError(errorText(result))
        }
        await onSaved()
        setSaving(false)
        toast.success(t('saved'))
        onBack()
    }

    const remove = async () => {
        setRemoving(true)
        const result = await removeTaxIdAction()
        if (!result.ok) {
            setRemoving(false)
            return toast.error(t('removeFailed'), { description: errorText(result) })
        }
        await onSaved()
        setRemoving(false)
        toast.success(t('removed'))
        onBack()
    }

    if (types.length === 0) {
        return (
            <>
                <RightTitle onBack={onBack}>{t('title')}</RightTitle>
                <p className="mt-6 text-sm text-muted-foreground">{t('noTaxId', { country: countryName(country, locale) })}</p>
            </>
        )
    }

    return (
        <>
            <RightTitle onBack={onBack}>{t('title')}</RightTitle>
            <form
                className="mt-6 flex flex-1 flex-col"
                onSubmit={event => {
                    event.preventDefault()
                    void save()
                }}
            >
                <div className="flex flex-col gap-4">
                    <Field label={t('nameLabel')} htmlFor="business-name">
                        <Input id="business-name" autoComplete="organization" value={name} onChange={event => setName(event.target.value)} disabled={saving} />
                    </Field>
                    {types.length > 1 && (
                        <Field label={t('typeLabel')} htmlFor="tax-id-type">
                            <Select value={type} onValueChange={next => setType(next as TaxIdType)} disabled={saving}>
                                <SelectTrigger id="tax-id-type" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                    {types.map(option => (
                                        <SelectItem key={option} value={option}>
                                            {option === 'eu_vat' ? t('euVat') : taxIdTypeLabel(option)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                    )}
                    <Field
                        label={type?.endsWith('_vat') ? t('field.vat') : t('field.taxId')}
                        htmlFor="tax-id-value"
                        helperText={countryName(country, locale)}
                        labelTrailing={savedNumberShown ? <TaxIdStatusBadge status={business.taxId!.status} /> : undefined}
                    >
                        <Input id="tax-id-value" autoComplete="off" spellCheck={false} placeholder={taxIdPlaceholder(type, country)} value={value} onChange={event => setValue(event.target.value)} disabled={saving} />
                    </Field>
                    {business.taxId && (
                        <ConfirmDialog
                            title={t('confirm.title')}
                            description={t('confirm.description')}
                            confirmLabel={t('confirm.confirm')}
                            pending={removing}
                            onConfirm={() => void remove()}
                        >
                            <button type="button" disabled={saving || removing} className="self-start text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-60">
                                {t('removeNumber')}
                            </button>
                        </ConfirmDialog>
                    )}
                </div>
                <PayFooter cta={t('save')} footnote={t('footnote')} loading={saving} disabled={unchanged || !name.trim() || !value.trim()} error={error} />
            </form>
        </>
    )
}
