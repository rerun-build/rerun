'use client'

import { Orb } from '@rerun/ui/foreman'
import { ScrollFade } from '@rerun/ui/primitives'

import type { SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import { DialogHeader } from '@/components/ui/dialog'

import { OfferArguments } from './offer-arguments'
import { DeclineButton, OfferFooter } from './offer-footer'
import { OfferConnect } from './OfferConnect'

export function OfferStep({ onPick, onKey, onOpencode, onSkip }: { onPick: (provider: SubscriptionProvider) => void; onKey: () => void; onOpencode?: () => void; onSkip: () => void }) {
    return (
        <>
            <DialogHeader className="mb-5">
                <Orb size={40} state="speaking" facing="right" className="mb-4" />
                <h2 className="text-xl font-semibold text-balance">Rerun works better with your Claude or ChatGPT subscription</h2>
                <p className="text-sm text-muted-foreground">Connect it and your coworkers run on the plan you already pay for.</p>
            </DialogHeader>

            <OfferConnect onPick={onPick} onKey={onKey} onOpencode={onOpencode} />

            {/* The arguments are not a third way in: they sit on their own, centred in what the
                buttons leave, well clear of the group above. The scroll is a guard, not a feature:
                a longer list must not push the footer out of the frame. Centred by `my-auto` and
                not `items-center`, which on a short window pushes the overflow up over the buttons
                where no scroll reaches it. `[&>div]` reaches the wrapper ScrollFade puts around its
                children, the only flex item the centring can act on. */}
            <ScrollFade className="-mx-1 flex min-h-0 flex-1 flex-col px-1 [&>div]:my-auto [&>div]:py-6">
                <OfferArguments />
            </ScrollFade>

            <OfferFooter>
                <DeclineButton onClick={onSkip} />
            </OfferFooter>
        </>
    )
}
