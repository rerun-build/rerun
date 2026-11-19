'use client'

import { HScrollFade } from '@moldwright/ui/primitives'
import { useRef } from 'react'

import type { StarterPackCard as Card } from '@/lib/foreman/starter-pack'
import { MAX_STARTER_PICKS } from '@/lib/onboarding/starter-packs'
import { StarterPackCard } from './StarterPackCard'
import type { StarterPicks } from './useStarterPicks'

const SNAP = { behavior: 'smooth', block: 'nearest', inline: 'center' } as const

export function StarterPackRail({ cards, picks }: { cards: Card[]; picks: StarterPicks }) {
    const rail = useRef<HTMLDivElement>(null)

    const toggle = (card: Card, index: number) => {
        const wasPicked = picks.isPicked(card.slug)
        const fillsTrial = picks.picked.length + 1 >= MAX_STARTER_PICKS
        picks.toggle(card.slug)
        if (wasPicked || fillsTrial) return
        const next = cards.slice(index + 1).find(other => !picks.isPicked(other.slug))
        if (next) rail.current?.querySelector(`[data-slug="${next.slug}"]`)?.scrollIntoView(SNAP)
    }

    return (
        <div ref={rail}>
            <HScrollFade className="snap-x snap-mandatory gap-3 scroll-smooth pb-1" fadeClassName="from-background">
                {cards.map((card, index) => (
                    <div key={card.slug} className="flex w-[86%] max-w-80 shrink-0 snap-center">
                        <StarterPackCard card={card} picked={picks.isPicked(card.slug)} locked={picks.full && !picks.isPicked(card.slug)} onToggle={() => toggle(card, index)} className="w-full" />
                    </div>
                ))}
            </HScrollFade>
        </div>
    )
}
