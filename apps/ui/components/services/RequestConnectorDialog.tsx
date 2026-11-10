'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { requestConnectorAction } from '@/app/api/_actions/connector-requests.actions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from '@/lib/icons'
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

type RequestConnectorDialogProps = {
    // The trigger (usually a Button) rendered via DialogTrigger asChild.
    children: React.ReactNode
    // Optional context: which agent the user was browsing when they asked.
    agentId?: string
}

function requestSchema(required: string) {
    return z.object({ description: z.string().trim().min(1, required) })
}

type FormValues = z.infer<ReturnType<typeof requestSchema>>

// Lets a user ask us to add a connector that the library does not have yet. The ask is
// persisted server-side via requestConnectorAction. Generic by design: no search term.
export function RequestConnectorDialog({ children, agentId }: RequestConnectorDialogProps) {
    const t = useTranslations('services.requestApp')
    const errorText = useErrorText()
    const [open, setOpen] = useState(false)
    const schema = useMemo(() => requestSchema(t('required')), [t])

    const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { description: '' } })
    const {
        formState: { isSubmitting },
    } = form

    const handleOpenChange = (next: boolean) => {
        setOpen(next)
        if (!next) form.reset({ description: '' })
    }

    const onSubmit = form.handleSubmit(async ({ description }) => {
        const res = await requestConnectorAction({ description, agentId })
        if (!res.ok) {
            toast.error(errorText(res))
            return
        }
        toast.success(t('sent'))
        handleOpenChange(false)
    })

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <Form {...form}>
                    <form onSubmit={onSubmit}>
                        <DialogHeader>
                            <DialogTitle>{t('title')}</DialogTitle>
                            <DialogDescription>{t('description')}</DialogDescription>
                        </DialogHeader>
                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem className="py-4">
                                    <FormControl>
                                        <Textarea autoFocus placeholder={t('placeholder')} className="min-h-28" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
                                {t('cancel')}
                            </Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting && <Loader2Icon className="size-4 animate-spin" />}
                                {t('send')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
