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
import { removeTaxIdAction, saveBusinessDetailsAction } from '@/ee/actions/billing.actions'
import { TAX_ID_STATUS_BADGE, taxIdPlaceholder, taxIdTypeLabel, taxIdTypesFor, type TaxIdStatus, type TaxIdType } from '@/ee/lib/billing/tax-id'
import type { BusinessDetails } from '@/ee/services/billing.service'

import { PayFooter } from './parts'

export function countryName(country: string, locale: string): string {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country
}

export function TaxIdStatusBadge({ status }: { status: TaxIdStatus | null }) {
    const t = useTranslations('billing.business.status')
    const badge = status ? TAX_ID_STATUS_BADGE[status] : null
    if (!status || !badge) return null
    return (
        <Badge size="sm" tone={badge.tone}>
            {t(status as Exclude<TaxIdStatus, 'unavailable'>)}
        </Badge>
    )
}

// The name and the tax number the invoices carry. `onSaved` reloads what the dialog shows, `onDone`
// says what changed once it has.
export function BusinessDetailsForm({ business, onSaved, onDone }: { business: BusinessDetails; onSaved: () => Promise<void>; onDone: (outcome: 'saved' | 'removed') => void }) {
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
        onDone('saved')
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
        onDone('removed')
    }

    if (types.length === 0) return <p className="text-sm text-muted-foreground">{t('noTaxId', { country: countryName(country, locale) })}</p>

    return (
        <form
            className="flex flex-1 flex-col"
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
    )
}
