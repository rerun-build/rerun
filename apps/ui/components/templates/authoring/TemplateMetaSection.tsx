'use client'

import { TEMPLATE_CATEGORIES } from '@rerun/contracts'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@rerun/ui/primitives'
import { Controller, useFormContext } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { TemplateFormValues } from '@/lib/templates/edit-schema'
import { META_DESCRIPTION_LIMIT, META_DESCRIPTION_MIN, META_TITLE_LIMIT, TITLE_LIMIT } from '@/lib/templates/limits'
import { cn } from '@/lib/utils'
import { useTemplateAuthoring } from './actions-context'
import { EnumSelect } from './EnumSelect'
import { PrefillButton } from './PrefillButton'

export function TemplateMetaSection() {
    const t = useTranslations('templates.authoring.meta')
    const tCategory = useTranslations('templates.categories')
    const categoryLabels = Object.fromEntries(TEMPLATE_CATEGORIES.map(category => [category, tCategory(category)]))
    const { control, setValue, watch } = useFormContext<TemplateFormValues>()
    const { scope, actions } = useTemplateAuthoring()
    const title = watch('title')

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardAction>
                    <PrefillButton
                        run={async brief => {
                            const result = await actions.prefillMeta(brief)
                            if (!result.ok) return result
                            setValue('title', result.title, { shouldDirty: true })
                            // The author surface leaves the URL alone, so its prefill returns no slug.
                            if (result.slug) setValue('slug', result.slug, { shouldDirty: true })
                            setValue('category', result.category, { shouldDirty: true })
                            setValue('tags', result.tags, { shouldDirty: true })
                            setValue('metaTitle', result.metaTitle, { shouldDirty: true })
                            setValue('metaDescription', result.metaDescription, { shouldDirty: true })
                            return result
                        }}
                    />
                </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                <div className={cn('grid gap-4', scope === 'admin' && 'sm:grid-cols-2')}>
                    <Controller
                        control={control}
                        name="title"
                        render={({ field, fieldState }) => (
                            <Input
                                label={t('titleLabel')}
                                maxLength={TITLE_LIMIT}
                                placeholder={t('titlePlaceholder')}
                                {...field}
                                helperText={fieldState.error?.message ?? `${field.value.length}/${TITLE_LIMIT}`}
                                aria-invalid={!!fieldState.error}
                            />
                        )}
                    />
                    {scope === 'admin' && (
                        <Controller
                            control={control}
                            name="slug"
                            render={({ field, fieldState }) => (
                                <Input
                                    label={t('slug')}
                                    placeholder="outbound-sdr"
                                    {...field}
                                    helperText={fieldState.error?.message ?? `/templates/${field.value || '…'}`}
                                    aria-invalid={!!fieldState.error}
                                />
                            )}
                        />
                    )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <Controller
                        control={control}
                        name="category"
                        render={({ field }) => (
                            <EnumSelect label={t('category')} value={field.value} onChange={field.onChange} options={TEMPLATE_CATEGORIES} labels={categoryLabels} />
                        )}
                    />
                    <Controller
                        control={control}
                        name="setupMinutes"
                        render={({ field, fieldState }) => (
                            <Input
                                label={t('setupTime')}
                                type="number"
                                min={1}
                                value={String(field.value)}
                                onChange={e => field.onChange(Number(e.target.value) || 1)}
                                helperText={fieldState.error?.message ?? t('setupTimeHelp')}
                                aria-invalid={!!fieldState.error}
                            />
                        )}
                    />
                </div>

                <Controller
                    control={control}
                    name="tags"
                    render={({ field }) => (
                        <Input
                            label={t('tags')}
                            optional
                            placeholder={t('tagsPlaceholder')}
                            helperText={t('tagsHelp')}
                            value={field.value.join(', ')}
                            onChange={e =>
                                field.onChange(
                                    e.target.value
                                        .split(',')
                                        .map(tag => tag.trim())
                                        .filter(Boolean),
                                )
                            }
                        />
                    )}
                />

                <div className="flex flex-col gap-4 border-t border-border pt-4">
                    <Controller
                        control={control}
                        name="metaTitle"
                        render={({ field }) => (
                            <Input
                                label={t('metaTitle')}
                                optional
                                maxLength={META_TITLE_LIMIT}
                                placeholder={title ? t('metaTitlePlaceholder', { title }) : t('metaTitleDefault')}
                                {...field}
                            />
                        )}
                    />
                    <Controller
                        control={control}
                        name="metaDescription"
                        render={({ field, fieldState }) => (
                            <Field
                                label={t('metaDescription')}
                                helperText={fieldState.error?.message ?? t('metaDescriptionHelp', { count: field.value.length, limit: META_DESCRIPTION_LIMIT, min: META_DESCRIPTION_MIN })}
                                error={fieldState.error?.message}
                            >
                                <Textarea
                                    {...field}
                                    rows={2}
                                    maxLength={META_DESCRIPTION_LIMIT}
                                    placeholder={t('metaDescriptionPlaceholder')}
                                />
                            </Field>
                        )}
                    />
                </div>
            </CardContent>
        </Card>
    )
}
