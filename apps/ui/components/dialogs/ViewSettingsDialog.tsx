'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { LayoutTile } from '@/components/data/LayoutTile'
import { SplitDialogContent } from '@/components/dialogs/SplitDialogContent'
import { ViewSettingsPreview } from '@/components/dialogs/ViewSettingsPreview'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { DataSource } from '@/lib/data/source'
import { columnsInUse, formValuesToInput, NONE, previewCard, toneColumn, viewFormSchema, viewToFormValues, type ViewFormValues } from '@/lib/data/view-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CARD_FIELD_ROLES, CARD_FORMATS, CARD_GALLERY_SHAPES, CARD_LAYOUTS, CARD_TONES, type CardLayout, type TableView } from '@rerun/contracts'
import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { useForm, type Control, type FieldPath } from 'react-hook-form'

const FORMAT_OPTIONS = [...CARD_FORMATS, 'currency:USD', 'currency:EUR', 'currency:GBP']
const MAX_TONED_VALUES = 12

type ViewSettingsDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    source: DataSource
    table: string
    columns: string[]
    /** The rows already on screen, drawn in the preview. */
    sample: { rows: Record<string, unknown>[]; total: number }
    /** Absent when adding a view. */
    view?: TableView
    /** The layout picked before the dialog opened, when adding a view. */
    initialLayout?: CardLayout
    onSaved: (view: TableView) => void
}

export function ViewSettingsDialog({ open, onOpenChange, source, table, columns, sample, view, initialLayout, onSaved }: ViewSettingsDialogProps) {
    const t = useTranslations('dialogs.viewSettings')
    const tCommon = useTranslations('common')
    const errorText = useErrorText()
    const schema = useMemo(() => viewFormSchema(t), [t])
    const form = useForm<ViewFormValues>({ resolver: zodResolver(schema), defaultValues: viewToFormValues(view, columns) })

    useEffect(() => {
        if (!open) return
        const defaults = viewToFormValues(view, columns)
        form.reset(!view && initialLayout ? { ...defaults, layout: initialLayout } : defaults)
    }, [open, view, initialLayout, columns, form])

    const values = form.watch()
    const layout = values.layout
    const toned = toneColumn(values)
    const toneValues = useToneValues(source, table, open ? toned : undefined)
    const input = formValuesToInput(values, view)
    const card = previewCard(input, { table, scope: source.scope, columns, rows: sample.rows, total: sample.total })

    const onSubmit = form.handleSubmit(async submitted => {
        const result = await source.saveView(table, formValuesToInput(submitted, view), view?.id)
        if (!result.success) {
            form.setError('root', { message: errorText(result) })
            return
        }
        onSaved(result.view)
        onOpenChange(false)
    })

    const roles = layout === 'list' ? CARD_FIELD_ROLES : CARD_FIELD_ROLES.filter(role => role !== 'date')

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <SplitDialogContent aside={<ViewSettingsPreview card={card} fileUrl={source.fileUrl} />}>
                <Form {...form}>
                    <form onSubmit={onSubmit} className="flex min-h-0 flex-col p-6">
                        <DialogHeader className="mb-4">
                            <DialogTitle>{view ? t('editTitle') : t('newTitle')}</DialogTitle>
                            <p className="text-sm text-muted-foreground">
                                {t.rich('description', { table, mono: chunks => <span className="font-mono">{chunks}</span> })}
                            </p>
                        </DialogHeader>

                        <ScrollFade className="-mx-1 -mt-1 min-h-0 flex-1 px-1 pb-6 pt-1">
                            <div className="space-y-5">
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <Input label={t('name')} required placeholder={t('namePlaceholder')} {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <Field label={t('layout')}>
                                    <div className="grid grid-cols-4 gap-2">
                                        {CARD_LAYOUTS.map(option => (
                                            <LayoutTile
                                                key={option}
                                                layout={option}
                                                active={layout === option}
                                                onClick={() => form.setValue('layout', option, { shouldValidate: form.formState.isSubmitted })}
                                            />
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground/70">{t(`layoutDescriptions.${layout}`)}</p>
                                </Field>

                                {layout === 'table' ? (
                                    <Field label={t('columns')} helperText={t('columnsHint')}>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3">
                                            {columns.map(column => (
                                                <label key={column} className="flex min-w-0 items-center gap-2 text-sm">
                                                    <Checkbox
                                                        size="sm"
                                                        checked={values.columns.includes(column)}
                                                        onCheckedChange={checked =>
                                                            form.setValue(
                                                                'columns',
                                                                columns.filter(c => (c === column ? !!checked : values.columns.includes(c))),
                                                            )
                                                        }
                                                    />
                                                    <span className="truncate font-mono text-xs">{column}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </Field>
                                ) : (
                                    <div className="grid grid-cols-2 gap-3">
                                        {layout === 'board' && <ColumnSelect control={form.control} name="groupBy" label={t('groupBy')} columns={columns} required />}
                                        {roles.map(role => (
                                            <ColumnSelect key={role} control={form.control} name={`fields.${role}`} label={t(`roles.${role}`)} columns={columns} required={role === 'title'} />
                                        ))}
                                    </div>
                                )}

                                {layout === 'gallery' && (
                                    <Field label={t('pictureShape')}>
                                        <Segmented
                                            options={CARD_GALLERY_SHAPES.map(shape => ({ value: shape, label: t(`shapes.${shape}`) }))}
                                            value={values.shape}
                                            onChange={shape => form.setValue('shape', shape)}
                                        />
                                    </Field>
                                )}

                                <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                                    <ColumnSelect control={form.control} name="sortColumn" label={t('sortBy')} columns={columns} noneLabel={t('insertionOrder')} />
                                    {values.sortColumn !== NONE && (
                                        <Segmented
                                            className="w-40"
                                            options={[
                                                { value: 'asc', label: t('ascending') },
                                                { value: 'desc', label: t('descending') },
                                            ]}
                                            value={values.sortDir}
                                            onChange={dir => form.setValue('sortDir', dir)}
                                        />
                                    )}
                                </div>

                                {columnsInUse(values).length > 0 && (
                                    <Field label={t('formats')} helperText={t('formatsHint')}>
                                        <div className="space-y-2 rounded-lg border p-3">
                                            {columnsInUse(values).map(column => {
                                                const current = values.formats[column] ?? NONE
                                                const options = FORMAT_OPTIONS.includes(current) || current === NONE ? FORMAT_OPTIONS : [...FORMAT_OPTIONS, current]
                                                return (
                                                    <div key={column} className="grid grid-cols-[1fr_10rem] items-center gap-3">
                                                        <span className="truncate font-mono text-xs">{column}</span>
                                                        <Select value={current} onValueChange={format => form.setValue('formats', { ...values.formats, [column]: format })}>
                                                            <SelectTrigger size="sm" className="w-full" aria-label={t('formatOf', { column })}>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value={NONE}>{t('plainFormat')}</SelectItem>
                                                                {options.map(format => (
                                                                    <SelectItem key={format} value={format}>
                                                                        {format}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </Field>
                                )}

                                {toned && toneValues.length > 0 && (
                                    <Field label={t('colors')} helperText={layout === 'board' ? t('colorsBoardHint') : undefined}>
                                        <div className="space-y-2 rounded-lg border p-3">
                                            {toneValues.slice(0, MAX_TONED_VALUES).map(value => (
                                                <div key={value} className="grid grid-cols-[1fr_10rem] items-center gap-3">
                                                    <span className="truncate text-xs">{value || t('emptyValue')}</span>
                                                    <Select value={values.tones[value] ?? NONE} onValueChange={tone => form.setValue('tones', { ...values.tones, [value]: tone })}>
                                                        <SelectTrigger size="sm" className="w-full" aria-label={value ? t('colorOf', { value }) : t('colorOfEmpty')}>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value={NONE}>{t('automaticColor')}</SelectItem>
                                                            {CARD_TONES.map(tone => (
                                                                <SelectItem key={tone} value={tone}>
                                                                    {tone}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            ))}
                                        </div>
                                    </Field>
                                )}

                                {form.formState.errors.root && <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>}
                            </div>
                        </ScrollFade>

                        <DialogFooter className="mt-auto -mx-6 -mb-6 border-t bg-muted/50 px-6 py-4">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                {tCommon('cancel')}
                            </Button>
                            <Button type="submit" disabled={form.formState.isSubmitting}>
                                {view ? tCommon('save') : t('create')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </SplitDialogContent>
        </Dialog>
    )
}

type ColumnSelectProps = {
    control: Control<ViewFormValues>
    name: FieldPath<ViewFormValues>
    label: string
    columns: string[]
    required?: boolean
    noneLabel?: string
}

function ColumnSelect({ control, name, label, columns, required, noneLabel }: ColumnSelectProps) {
    const t = useTranslations('dialogs.viewSettings')
    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <Field label={label} optional={!required}>
                        <Select value={field.value as string} onValueChange={field.onChange}>
                            <FormControl>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {!required && <SelectItem value={NONE}>{noneLabel ?? t('none')}</SelectItem>}
                                {required && field.value === NONE && <SelectItem value={NONE}>{t('pickColumn')}</SelectItem>}
                                {columns.map(column => (
                                    <SelectItem key={column} value={column}>
                                        <span className="font-mono text-xs">{column}</span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <FormMessage />
                </FormItem>
            )}
        />
    )
}

// The distinct values of the column that gets colors, read over the whole table rather than the
// rows on screen, so a status not on this page can still be given its color.
function useToneValues(source: DataSource, table: string, column: string | undefined): string[] {
    const [values, setValues] = useState<{ column: string; values: string[] } | null>(null)

    useEffect(() => {
        if (!column) return
        let cancelled = false
        source.readGroups(table, { groupBy: column }).then(result => {
            if (cancelled || !result.success) return
            setValues({ column, values: result.groups.map(group => (group.value === null ? '' : String(group.value))) })
        })
        return () => {
            cancelled = true
        }
    }, [source, table, column])

    return column && values?.column === column ? values.values : []
}
