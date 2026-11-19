import { create } from 'zustand'
import type { AddonKey } from '@moldwright/cloud/billing'

export const AGENT_LIMIT_TRIGGER = 'entitlement_gate'

export type BillingUpgrade = { coworker?: string; onPaid?: () => void }

type BillingState = {
    open: boolean
    highlightAddon: AddonKey | null
    trigger: string | null
    upgrade: BillingUpgrade | null
    openBilling: (highlight?: AddonKey, trigger?: string, upgrade?: BillingUpgrade) => void
    setOpen: (open: boolean) => void
}

export const useBillingStore = create<BillingState>(set => ({
    open: false,
    highlightAddon: null,
    trigger: null,
    upgrade: null,
    openBilling: (highlight, trigger, upgrade) => set({ open: true, highlightAddon: highlight ?? null, trigger: trigger ?? 'manual', upgrade: upgrade ?? null }),
    setOpen: open => set(open ? { open } : { open: false, highlightAddon: null, trigger: null, upgrade: null }),
}))
