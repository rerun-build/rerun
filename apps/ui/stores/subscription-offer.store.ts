import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type SubscriptionOfferState = {
    open: boolean
    agentId: string | null
    offered: boolean
    release: (() => void) | null
    offer: (agentId: string) => Promise<void>
    answer: () => void
}

export const useSubscriptionOfferStore = create<SubscriptionOfferState>()(
    persist(
        (set, get) => ({
            open: false,
            agentId: null,
            offered: false,
            release: null,
            offer: agentId =>
                new Promise<void>(resolve => {
                    if (get().offered) return resolve()
                    const waiting = get().release
                    set({
                        open: true,
                        agentId,
                        release: () => {
                            waiting?.()
                            resolve()
                        },
                    })
                }),
            answer: () => {
                const { release } = get()
                set({ open: false, offered: true, release: null })
                release?.()
            },
        }),
        {
            name: 'rerun:subscription-offer',
            partialize: state => ({ offered: state.offered }),
        }
    )
)
