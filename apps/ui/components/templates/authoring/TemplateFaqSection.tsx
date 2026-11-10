'use client'

import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@rerun/ui/primitives'
import { Controller, useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2 } from '@/lib/icons'
import type { TemplateFormValues } from '@/lib/templates/edit-schema'
import { FAQ_ANSWER_LIMIT, FAQ_QUESTION_LIMIT } from '@/lib/templates/limits'
import { useTemplateAuthoring } from './actions-context'
import { PrefillButton } from './PrefillButton'

export function TemplateFaqSection() {
    const t = useTranslations('templates.authoring.faq')
    const { control, getValues } = useFormContext<TemplateFormValues>()
    const { actions } = useTemplateAuthoring()
    const { fields, append, remove, replace } = useFieldArray({ control, name: 'faq' })

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('title')}</CardTitle>
                <CardAction>
                    <PrefillButton
                        run={async brief => {
                            const result = await actions.prefillFaq({ brief, longDescription: getValues('longDescription') })
                            if (!result.ok) return result
                            // `replace` rather than setValue: the field array owns the keys the inputs render against.
                            replace(result.faq)
                            return result
                        }}
                    />
                </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">{t('hint')}</p>

                {fields.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">{t('empty')}</p>
                ) : (
                    fields.map((field, index) => (
                        <div key={field.id} className="flex items-start gap-3 rounded-lg border border-foreground/10 p-3">
                            <div className="flex flex-1 flex-col gap-3">
                                <Controller
                                    control={control}
                                    name={`faq.${index}.question`}
                                    render={({ field: f, fieldState }) => (
                                        <Input
                                            label={t('question')}
                                            placeholder={t('questionPlaceholder')}
                                            maxLength={FAQ_QUESTION_LIMIT}
                                            {...f}
                                            helperText={fieldState.error?.message}
                                            aria-invalid={!!fieldState.error}
                                        />
                                    )}
                                />
                                <Controller
                                    control={control}
                                    name={`faq.${index}.answer`}
                                    render={({ field: f, fieldState }) => (
                                        <Field label={t('answer')} helperText={fieldState.error?.message} error={fieldState.error?.message}>
                                            <Textarea {...f} rows={3} maxLength={FAQ_ANSWER_LIMIT} placeholder={t('answerPlaceholder')} />
                                        </Field>
                                    )}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => remove(index)}
                                aria-label={t('remove')}
                                className="mt-6 shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                            >
                                <Trash2 className="size-4" />
                            </button>
                        </div>
                    ))
                )}

                <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => append({ question: '', answer: '' })}>
                    <Plus />
                    {t('add')}
                </Button>
            </CardContent>
        </Card>
    )
}
