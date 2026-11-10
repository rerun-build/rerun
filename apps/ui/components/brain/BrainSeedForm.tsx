'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { seedCompanyBrainAction } from '@/app/api/_actions/brain-seed.actions'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

const websiteSchema = (required: string) => z.object({ website: z.string().trim().min(3, required) })

type SeedValues = z.infer<ReturnType<typeof websiteSchema>>

// Rerun reads the site the way the onboarding does, then writes the identity card in the
// background: the pages show up a few minutes later, not on submit.
export function BrainSeedForm({ onStarted }: { onStarted: () => void }) {
    const t = useTranslations('brain.seed')
    const errorText = useErrorText()
    const schema = useMemo(() => websiteSchema(t('required')), [t])
    const form = useForm<SeedValues>({ resolver: zodResolver(schema), defaultValues: { website: '' } })

    const submit = form.handleSubmit(async ({ website }) => {
        const result = await seedCompanyBrainAction(website)
        if (!result.ok) {
            form.setError('website', { message: errorText(result) })
            return
        }
        onStarted()
    })

    return (
        <Form {...form}>
            <form onSubmit={submit} className="flex w-full max-w-sm items-start gap-2">
                <FormField
                    control={form.control}
                    name="website"
                    render={({ field }) => (
                        <FormItem className="flex-1">
                            <FormControl>
                                <Input hideRequired placeholder="acme.com" aria-label={t('websiteLabel')} {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button type="submit" loading={form.formState.isSubmitting}>
                    {t('submit')}
                </Button>
            </form>
        </Form>
    )
}
