'use client'

import { serializeStarterPicks } from '@rerun/contracts'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { loadOnboardingStarterPackAction } from '@/app/api/_actions/onboarding-dialog.actions'
import { StarterPackPicker } from '@/components/foreman/widgets/starter-pack/StarterPackWidget'
import type { StarterPackInput } from '@/lib/foreman/starter-pack'

/**
 * The starter pack of a workspace the onboarding dialog just handed over, drawn by the app under the
 * Chief of Staff's first message. Picking sends one message: a line it reads, then the sentence the
 * person sees. A line written in the composer instead reaches it as any message does.
 */
export function HandoffStarterPack({ send }: { send: (text: string) => void }) {
    const t = useTranslations('onboarding.handoff')
    const locale = useLocale()
    const [pack, setPack] = useState<StarterPackInput | null>(null)

    useEffect(() => {
        let cancelled = false
        void loadOnboardingStarterPackAction()
            .catch(() => null)
            .then(loaded => {
                if (!cancelled) setPack(loaded)
            })
        return () => {
            cancelled = true
        }
    }, [])

    if (!pack) return null
    return (
        <StarterPackPicker
            cards={pack.cards}
            onAnswer={answer => {
                if (!answer.answered || !('chosen' in answer)) return
                const names = new Intl.ListFormat(locale, { type: 'conjunction' }).format(pack.cards.filter(card => answer.chosen.includes(card.slug)).map(card => card.agent))
                send(serializeStarterPicks(answer.chosen, t('picked', { names })))
            }}
        />
    )
}
