'use client'

import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { MESSAGE_FEEDBACK_CATEGORIES, MESSAGE_FEEDBACK_CATEGORY_VALUES, type MessageFeedbackCategory, type MessageFeedbackRating } from '@rerun/contracts'
import { Loader2Icon, ThumbsDownIcon, ThumbsUpIcon } from '@/lib/icons'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const schema = z.object({
    category: z.enum(MESSAGE_FEEDBACK_CATEGORY_VALUES).optional(),
    details: z.string().max(5_000),
})

type FormValues = z.infer<typeof schema>

export type MessageFeedbackDetails = { category: MessageFeedbackCategory | null; details: string }

type MessageFeedbackDialogProps = {
    open: boolean
    rating: MessageFeedbackRating
    onOpenChange: (open: boolean) => void
    // Resolves to whether the details were saved, which is what closes the dialog.
    onSubmit: (details: MessageFeedbackDetails) => Promise<boolean>
}

export function MessageFeedbackDialog({ open, rating, onOpenChange, onSubmit }: MessageFeedbackDialogProps) {
    const t = useTranslations('chat.feedback')
    const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { category: undefined, details: '' } })
    const {
        formState: { isSubmitting },
    } = form

    useEffect(() => {
        if (open) form.reset({ category: undefined, details: '' })
    }, [open, form])

    const negative = rating === 'down'

    const submit = form.handleSubmit(async ({ category, details }) => {
        if (await onSubmit({ category: negative ? (category ?? null) : null, details })) onOpenChange(false)
    })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <Form {...form}>
                    <form onSubmit={submit} className="flex flex-col gap-4">
                        <DialogHeaderBar icon={negative ? ThumbsDownIcon : ThumbsUpIcon} title={negative ? t('negativeTitle') : t('positiveTitle')} />
                        {negative && (
                            <FormField
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                    <FormItem>
                                        <Field label={t('categoryLabel')} optional>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger className="w-full">
                                                        <SelectValue placeholder={t('categoryPlaceholder')} />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {MESSAGE_FEEDBACK_CATEGORIES.map(category => (
                                                        <SelectItem key={category.value} value={category.value}>
                                                            {t(`categories.${category.value}`)}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </Field>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}
                        <FormField
                            control={form.control}
                            name="details"
                            render={({ field }) => (
                                <FormItem>
                                    <Field label={t('detailsLabel')} optional>
                                        <FormControl>
                                            <Textarea autoFocus={!negative} placeholder={negative ? t('negativePlaceholder') : t('positivePlaceholder')} className="min-h-24" {...field} />
                                        </FormControl>
                                    </Field>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <p className="text-xs text-muted-foreground">{t('disclaimer')}</p>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                                {t('cancel')}
                            </Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting && <Loader2Icon className="size-4 animate-spin" />}
                                {t('submit')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
