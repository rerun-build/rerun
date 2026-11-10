'use client'

import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { PhoneNumberInput } from '@/components/ui/phone-number-input'
import { countryFromLocale, toE164 } from '@/lib/phone/normalize'
import { zodResolver } from '@hookform/resolvers/zod'
import type { CountryCode } from 'libphonenumber-js/min'
import { useTranslations } from 'next-intl'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

export type PhoneNumberRequest = { phone: string; country: CountryCode }


const FALLBACK_COUNTRY = countryFromLocale(undefined)
const neverChanges = () => () => {}

// A phone number taken in as typed, without a code. `submit` rejects with the message to show under
// the field; `skip` is the way past without a number.
export function PhoneNumberForm({ submit, skip }: { submit: (request: PhoneNumberRequest) => Promise<void>; skip: () => Promise<void> }) {
    const t = useTranslations('auth.phone')
    const phoneSchema = useMemo(() => z.object({ phone: z.string().trim().min(1, t('errors.phoneRequired')) }), [t])
    const [skipping, setSkipping] = useState(false)
    // The server has no idea where the visitor is, so the guess only joins in on the client.
    const localeCountry = useSyncExternalStore(
        neverChanges,
        () => countryFromLocale(navigator.language),
        () => FALLBACK_COUNTRY
    )
    const [pickedCountry, setPickedCountry] = useState<CountryCode | null>(null)
    const country = pickedCountry ?? localeCountry
    const form = useForm<z.infer<typeof phoneSchema>>({ resolver: zodResolver(phoneSchema), defaultValues: { phone: '' } })

    const onSubmit = form.handleSubmit(async ({ phone }) => {
        if (!toE164(phone, country)) {
            form.setError('phone', { message: t('errors.invalidNumber') })
            return
        }
        try {
            await submit({ phone, country })
        } catch (error) {
            form.setError('phone', { message: error instanceof Error ? error.message : t('errors.generic') })
        }
    })

    const onSkip = async () => {
        setSkipping(true)
        try {
            await skip()
        } finally {
            setSkipping(false)
        }
    }

    const submitting = form.formState.isSubmitting

    return (
        <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-4">
                <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <PhoneNumberInput label={t('label')} autoFocus country={country} {...field} onCountryChange={setPickedCountry} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="space-y-2">
                    <Button type="submit" className="w-full" loading={submitting} disabled={skipping}>
                        {t('code.submit')}
                    </Button>
                    <Button type="button" variant="ghost" onClick={onSkip} loading={skipping} disabled={submitting} className="w-full text-muted-foreground">
                        {t('skip')}
                    </Button>
                </div>
                <p className="text-center text-xs text-muted-foreground text-balance">{t('consent')}</p>
            </form>
        </Form>
    )
}
