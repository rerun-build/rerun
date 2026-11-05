'use client'

import { track } from '@rerun/analytics/client'
import { DEFAULT_CONNECTION_MODELS } from '@rerun/contracts'

import { SplitDialogContent } from '@/components/dialogs/SplitDialogContent'
import { OfferBoardPanel } from '@/components/dialogs/subscription-offer/OfferBoardPanel'
import { SubscriptionOffer } from '@/components/dialogs/subscription-offer/SubscriptionOffer'
import { Dialog, DialogTitle } from '@/components/ui/dialog'
import { useWorkspaceConnections } from '@/hooks/useWorkspaceConnections'
import { suggestName, type AddableProvider } from '@/lib/engine/ai-sources'
import { useSubscriptionOfferStore } from '@/stores/subscription-offer.store'

// Offered once, before the first install starts: the moment a workspace meets its first coworker is
// the one where it learns that coworker can run on a plan it already pays for. Every way out marks
// the offer made and lets the install start, Escape included.
export function SubscriptionOfferDialog() {
    const open = useSubscriptionOfferStore(state => state.open)
    const answer = useSubscriptionOfferStore(state => state.answer)

    return (
        <Dialog open={open} onOpenChange={next => !next && answer()}>
            {/* A stray click outside would spend the only time this is offered, and cut the wait
                on the ChatGPT code short. */}
            <SplitDialogContent aside={<OfferBoardPanel className="border-l" />} onInteractOutside={event => event.preventDefault()}>
                <DialogTitle className="sr-only">Run your coworkers on your Claude or ChatGPT plan</DialogTitle>
                <ConnectedOffer onClose={answer} />
            </SplitDialogContent>
        </Dialog>
    )
}

// Mounted with the dialog rather than with the app: the connections are only asked for once there
// is a machine to hold them.
function ConnectedOffer({ onClose }: { onClose: () => void }) {
    const { connections, opencodeOffered, create } = useWorkspaceConnections()

    const connect = (provider: AddableProvider, keys: Record<string, string>) => {
        const takenNames = connections.map(connection => connection.name)
        return create({ name: suggestName(provider, takenNames), provider, models: DEFAULT_CONNECTION_MODELS[provider], extraModels: [], keys }, 'subscription_offer')
    }

    return <SubscriptionOffer onPick={provider => track('connection_cta_clicked', { source: `onboarding_offer_${provider}` })} onKeys={connect} onSkip={onClose} onDone={onClose} opencodeOffered={opencodeOffered} />
}
