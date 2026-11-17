'use client'

import { formatNumber } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { addAppSlotAction, removeAppSlotAction } from '@/app/api/_actions/apps.actions'
import type { AppsOverview } from '@/app/api/_services/apps.service'
import { useErrorText } from '@/hooks/useErrorText'
import type { AppSlug } from '@/lib/apps/types'
import { randomUuid } from '@/lib/random-uuid'

type SlotHandlers = {
    load: () => Promise<AppsOverview | null>
    setPending: (pending: string | null) => void
    setError: (error: string | null) => void
}

// Adding and giving back a slot, the same in every paid app's dialog.
export function usePaidAppSlots(slug: AppSlug, { load, setPending, setError }: SlotHandlers) {
    const t = useTranslations('dialogs')
    const errorText = useErrorText()
    const locale = useLocale()

    const addSlot = async () => {
        setPending('slot')
        setError(null)
        const result = await addAppSlotAction(slug, randomUuid())
        if (!result.ok) {
            setPending(null)
            return setError(errorText(result))
        }
        // A lifetime workspace's first slot is bought on Stripe's page, which comes back here.
        if (result.value.checkoutUrl) return window.location.assign(result.value.checkoutUrl)
        setPending(null)
        toast.success(result.value.trialSlot ? t('paidApp.slotAddedTrial', { price: formatNumber(0, locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }) : t('paidApp.slotAdded'))
        // The webhook moves the slot count, a moment after Stripe answers.
        setTimeout(() => void load(), 1500)
        await load()
    }

    const removeSlot = async () => {
        setPending('slot')
        setError(null)
        const result = await removeAppSlotAction(slug)
        setPending(null)
        if (!result.ok) return setError(errorText(result))
        toast.success(t('paidApp.slotRemoved'))
        setTimeout(() => void load(), 1500)
        await load()
    }

    return { addSlot, removeSlot }
}
