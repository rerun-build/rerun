'use client'

import { MIN_TEMPLATE_PRICE_CENTS, TEMPLATE_PRICING_MODELS, type TemplatePricingModel } from '@rerun/contracts'
import { Card, CardContent, CardHeader, CardTitle } from '@rerun/ui/primitives'
import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Controller, useFormContext } from 'react-hook-form'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { WalletIcon } from '@/lib/icons'
import type { TemplateFormValues } from '@/lib/templates/edit-schema'
import { useCreatorStore } from '@/stores/creator.store'
import { useTemplateAuthoring } from '@/components/templates/authoring/actions-context'
import { EnumSelect } from '@/components/templates/authoring/EnumSelect'
import { PricePayoutPreview } from './PricePayoutPreview'

// The form holds cents, the input holds a string. Deriving the text from the number would make a
// trailing dot or a leading zero impossible to type, so the two are kept side by side and only the
// number is authoritative.
function centsToText(cents: number): string {
    if (!cents) return ''
    return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
}

function textToCents(text: string): number {
    const value = Number.parseFloat(text.replace(',', '.'))
    return Number.isFinite(value) ? Math.round(value * 100) : 0
}

export function TemplatePricingSection() {
    const t = useTranslations('templates.pricing')
    const modelLabels: Record<TemplatePricingModel, string> = { free: t('models.free'), one_time: t('models.one_time'), recurring: t('models.recurring') }
    const { control, watch, setValue } = useFormContext<TemplateFormValues>()
    const { scope, payoutsReady } = useTemplateAuthoring()
    const setPane = useCreatorStore(state => state.setPane)

    const model = watch('pricingModel')
    const amountCents = watch('priceAmountCents')
    const [amountText, setAmountText] = React.useState(() => centsToText(amountCents))

    const changeModel = (next: TemplatePricingModel) => {
        setValue('pricingModel', next, { shouldDirty: true })
        if (next !== 'free') return
        // A free template carries no amount, and the schema refuses one.
        setAmountText('')
        setValue('priceAmountCents', 0, { shouldDirty: true })
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <Controller
                    control={control}
                    name="pricingModel"
                    render={({ field }) => (
                        <EnumSelect
                            label={t('title')}
                            value={field.value}
                            onChange={changeModel}
                            options={TEMPLATE_PRICING_MODELS}
                            labels={modelLabels}
                            helperText={t('modelHelp', { helper: t(`helpers.${field.value}`) })}
                        />
                    )}
                />

                {model !== 'free' && (
                    <>
                        <Controller
                            control={control}
                            name="priceAmountCents"
                            render={({ field, fieldState }) => (
                                <Input
                                    label={t('priceLabel')}
                                    type="number"
                                    min={MIN_TEMPLATE_PRICE_CENTS / 100}
                                    step="1"
                                    placeholder="29"
                                    value={amountText}
                                    onChange={event => {
                                        setAmountText(event.target.value)
                                        field.onChange(textToCents(event.target.value))
                                    }}
                                    helperText={fieldState.error?.message ?? t('priceHelp', { min: `$${MIN_TEMPLATE_PRICE_CENTS / 100}` })}
                                    aria-invalid={!!fieldState.error}
                                />
                            )}
                        />

                        <PricePayoutPreview model={model} amountCents={amountCents} currency="usd" />
                    </>
                )}

                {model !== 'free' && scope === 'author' && !payoutsReady && (
                    <Alert variant="warning" stripes className="grid-cols-[auto_1fr] gap-x-3 gap-y-0">
                        <Icon icon={WalletIcon} size="sm" className="row-span-2 self-center" />
                        <AlertTitle className="col-start-2 leading-tight">{t('payoutsTitle')}</AlertTitle>
                        <AlertDescription className="col-start-2 leading-snug">
                            {t('payoutsBody')}
                            <Button type="button" variant="link" size="sm" className="mt-1 h-auto p-0" onClick={() => setPane({ kind: 'payouts' })}>
                                {t('setUpPayouts')}
                            </Button>
                        </AlertDescription>
                    </Alert>
                )}
            </CardContent>
        </Card>
    )
}
