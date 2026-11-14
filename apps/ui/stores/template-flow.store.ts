import { create } from 'zustand'
import type { LibraryTemplate } from '@/lib/templates/library'

type TemplateFlowState = {
    linkSlug: string | null
    linkTemplate: LibraryTemplate | null
    purchase: { slug: string; sessionId: string | null } | null
    openLink: (slug: string) => void
    resolveLink: (template: LibraryTemplate) => void
    closeLink: () => void
    openPurchase: (purchase: { slug: string; sessionId: string | null }) => void
    closePurchase: () => void
}

export const useTemplateFlowStore = create<TemplateFlowState>()(set => ({
    linkSlug: null,
    linkTemplate: null,
    purchase: null,
    openLink: slug => set(state => ({ linkSlug: slug, linkTemplate: state.linkTemplate?.slug === slug ? state.linkTemplate : null })),
    resolveLink: template => set({ linkTemplate: template }),
    closeLink: () => set({ linkSlug: null, linkTemplate: null }),
    openPurchase: purchase => set({ purchase }),
    closePurchase: () => set({ purchase: null }),
}))

export function isTemplateFlowBusy(state: Pick<TemplateFlowState, 'linkSlug' | 'purchase'>): boolean {
    return !!state.linkSlug || !!state.purchase
}
